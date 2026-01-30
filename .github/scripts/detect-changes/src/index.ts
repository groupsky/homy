#!/usr/bin/env node
/**
 * Main entry point for detect-changes tool.
 *
 * This tool analyzes Docker-based projects to detect:
 * - Changed base images and services
 * - Dependencies between images
 * - Which images need building vs retagging
 * - Services with tests and healthchecks
 */

import { Command } from 'commander';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { discoverBaseImages, buildDirectoryToGhcrMapping } from './lib/base-images.js';
import { discoverServicesFromCompose, filterGhcrServices } from './lib/services.js';
import { buildReverseDependencyMap, detectAffectedServices } from './lib/dependency-graph.js';
import { detectChangedBaseImages, detectChangedServices, isTestOnlyChange } from './lib/change-detection.js';
import { hasHealthcheck, extractFinalStageBase } from './lib/dockerfile-parser.js';
import { checkAllServices, validateForkPrBaseImages } from './lib/ghcr-client.js';
import { validatePackageJson, validateNvmrc } from './lib/validation.js';
import type { DetectionResult, GitHubActionsOutputs, Service } from './lib/types.js';

interface CliOptions {
  baseRef: string;
  baseImagesDir: string;
  composeFile: string;
  envFile: string;
  dockerDir: string;
  isFork?: boolean;
  outputFile: string;
  baseSha: string;
}

/**
 * Check if a service has a package.json with real tests.
 * A service is testable if it has package.json with a test script that doesn't just echo or exit.
 */
function serviceHasRealTests(service: Service): boolean {
  try {
    const packageJsonPath = path.join(service.build_context, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    return validatePackageJson(packageJsonPath);
  } catch {
    return false;
  }
}

/**
 * Check if a service has an .nvmrc file and uses a node base image.
 */
function needsVersionCheck(service: Service): boolean {
  try {
    // Check for .nvmrc
    const nvmrcPath = path.join(service.build_context, '.nvmrc');
    if (!existsSync(nvmrcPath)) {
      return false;
    }

    // Validate .nvmrc format
    if (!validateNvmrc(nvmrcPath)) {
      return false;
    }

    // Check if Dockerfile uses node base image
    const dockerfileContent = readFileSync(service.dockerfile_path, 'utf-8');
    const finalBase = extractFinalStageBase(dockerfileContent);

    if (!finalBase) {
      return false;
    }

    // Check if base image is a node image
    return finalBase.includes('node') || finalBase.includes('ghcr.io/groupsky/homy/node');
  } catch {
    return false;
  }
}

/**
 * Extract base images needed from services that will be built.
 * Returns unique list of base image directories needed.
 */
function extractBaseImagesNeeded(
  servicesToBuild: string[],
  services: Service[],
  baseImageMapping: { dir_to_ghcr: Record<string, string>; ghcr_to_dir: Record<string, string> }
): string[] {
  const neededBaseDirs = new Set<string>();

  for (const serviceName of servicesToBuild) {
    const service = services.find((s) => s.service_name === serviceName);
    if (!service) {
      continue;
    }

    try {
      // Read Dockerfile and extract final base image
      const dockerfileContent = readFileSync(service.dockerfile_path, 'utf-8');
      const finalBase = extractFinalStageBase(dockerfileContent);

      if (!finalBase) {
        continue;
      }

      // Check if this is a GHCR base image we track
      if (!finalBase.startsWith('ghcr.io/groupsky/homy/')) {
        continue;
      }

      // Look up base image directory
      const baseDir = baseImageMapping.ghcr_to_dir[finalBase];
      if (baseDir) {
        neededBaseDirs.add(baseDir);
      }
    } catch {
      // Skip on errors
      continue;
    }
  }

  return Array.from(neededBaseDirs).sort();
}

/**
 * Convert DetectionResult to GitHub Actions output format.
 */
function convertToGitHubOutputs(result: DetectionResult): GitHubActionsOutputs {
  return {
    // Base image outputs
    base_images: JSON.stringify(result.base_images),
    changed_base_images: JSON.stringify(result.changed_base_images),
    base_images_needed: JSON.stringify(result.base_images_needed),
    unused_base_images: JSON.stringify(result.unused_base_images),

    // Service outputs
    services: JSON.stringify([...result.changed_services, ...result.affected_services].sort()),
    changed_services: JSON.stringify(result.changed_services),
    affected_services: JSON.stringify(result.affected_services),

    // Build strategy outputs
    to_build: JSON.stringify(result.to_build),
    to_retag: JSON.stringify(result.to_retag),
    to_pull_for_testing: JSON.stringify(result.to_pull_for_testing),

    // Test and verification outputs
    testable_services: JSON.stringify(result.testable_services),
    healthcheck_services: JSON.stringify(result.healthcheck_services),
    version_check_services: JSON.stringify(result.version_check_services),

    // Legacy outputs (kept for backwards compatibility)
    services_with_tests: JSON.stringify(result.testable_services),
    services_with_healthcheck: JSON.stringify(result.healthcheck_services),

    // Flags
    should_run_base_images: (result.changed_base_images.length > 0).toString(),
    should_run_services: (result.to_build.length > 0).toString(),
  };
}

/**
 * Main detection workflow.
 */
async function detectChanges(options: CliOptions): Promise<DetectionResult> {
  console.error('Step 1: Discovering base images...');
  const baseImages = discoverBaseImages(options.baseImagesDir);
  console.error(`Found ${baseImages.length} base images`);

  console.error('Step 2: Building directory to GHCR mapping...');
  const baseImageMapping = buildDirectoryToGhcrMapping(options.baseImagesDir);
  console.error(`Mapped ${Object.keys(baseImageMapping.dir_to_ghcr).length} base images`);

  console.error('Step 3: Discovering services from docker-compose...');
  const allServices = discoverServicesFromCompose(options.composeFile, options.envFile);
  const services = filterGhcrServices(allServices);
  console.error(`Found ${services.length} GHCR services (${allServices.length} total)`);

  console.error('Step 4: Detecting changed base images...');
  const changedBaseImages = detectChangedBaseImages(options.baseRef, baseImages);
  console.error(`Changed base images: ${changedBaseImages.length}`);

  console.error('Step 5: Detecting changed services...');
  const changedServices = detectChangedServices(options.baseRef, services);
  console.error(`Changed services: ${changedServices.length}`);

  console.error('Step 6: Building reverse dependency map...');
  const reverseDeps = buildReverseDependencyMap(services, options.dockerDir, baseImageMapping);
  console.error(`Built dependency map with ${reverseDeps.size} base images`);

  console.error('Step 7: Detecting affected services...');
  const affectedServices = detectAffectedServices(changedBaseImages, reverseDeps, baseImageMapping);
  console.error(`Affected services: ${affectedServices.length}`);

  // Combine changed and affected services for build list
  const servicesToBuild = Array.from(new Set([...changedServices, ...affectedServices])).sort();

  console.error('Step 8: Extracting base images needed...');
  const baseImagesNeeded = extractBaseImagesNeeded(servicesToBuild, services, baseImageMapping);
  console.error(`Base images needed: ${baseImagesNeeded.length}`);

  console.error('Step 8.5: Detecting unused base images...');
  // Find base images that are not referenced by any service
  const allBaseDirs = baseImages.map((img) => img.directory);
  const referencedBaseDirs = new Set(reverseDeps.keys());
  const unusedBaseImages = allBaseDirs.filter((dir) => !referencedBaseDirs.has(dir)).sort();
  console.error(`Unused base images: ${unusedBaseImages.length}`);

  if (unusedBaseImages.length > 0) {
    console.error('');
    console.error('⚠️  WARNING: Unused base images detected!');
    console.error('');
    console.error('The following base image directories are not referenced by any service:');
    for (const dir of unusedBaseImages) {
      console.error(`  - ${dir}`);
    }
    console.error('');
    console.error('These base images should be removed from the base-images/ directory.');
    console.error('If a service no longer uses a base image, remove the base image directory.');
    console.error('');
    console.error('Note: This check will be enforced in a separate validation job.');
  }

  // Step 9: Fork PR validation (if applicable)
  if (options.isFork) {
    console.error('Step 9: Validating fork PR base images...');
    // Convert base image directories to GHCR tags
    const baseImageTags = baseImagesNeeded.map((dir) => baseImageMapping.dir_to_ghcr[dir]).filter(Boolean);
    await validateForkPrBaseImages(options.isFork, baseImageTags);
    console.error('Fork PR validation: passed');
  }

  // Step 10: GHCR existence checks
  console.error('Step 10: Checking GHCR for existing images...');
  const servicesForCheck = services.filter((s) => servicesToBuild.includes(s.service_name));
  const checkResult = await checkAllServices(servicesForCheck, options.baseSha);
  const toBuild = checkResult.toBuild;
  const toRetag = checkResult.toRetag;
  console.error(`To build: ${toBuild.length}, To retag: ${toRetag.length}`);

  // Step 10.5: Detect test-only changes
  console.error('Step 10.5: Detecting test-only changes...');
  const toPullForTesting: string[] = [];

  for (const serviceName of changedServices) {
    // Skip if already marked for building
    if (toBuild.includes(serviceName)) {
      continue;
    }

    // Find service object
    const service = services.find((s) => s.service_name === serviceName);
    if (!service) {
      continue;
    }

    // Check if this is a test-only change
    if (isTestOnlyChange(options.baseRef, service)) {
      // Verify that image exists in toRetag (already checked by Step 10)
      // If image exists at base SHA, we can pull it for testing
      if (toRetag.includes(serviceName)) {
        toPullForTesting.push(serviceName);
      } else {
        // Image doesn't exist, must build despite test-only change
        // This can happen if base image changed (service is in affectedServices)
        toBuild.push(serviceName);
      }
    }
  }

  console.error(`Test-only changes: ${toPullForTesting.length}`);

  console.error('Step 11: Detecting testable services...');
  // Tests should run for all changed services, not just ones being built
  const testableServices = services
    .filter((s) => changedServices.includes(s.service_name) || affectedServices.includes(s.service_name))
    .filter(serviceHasRealTests)
    .map((s) => s.service_name)
    .sort();
  console.error(`Testable services: ${testableServices.length}`);

  console.error('Step 12: Detecting healthcheck services...');
  // Health checks should run for all changed services, not just ones being built
  const healthcheckServices = services
    .filter((s) => changedServices.includes(s.service_name) || affectedServices.includes(s.service_name))
    .filter((s) => {
      try {
        const content = readFileSync(s.dockerfile_path, 'utf-8');
        return hasHealthcheck(content);
      } catch {
        return false;
      }
    })
    .map((s) => s.service_name)
    .sort();
  console.error(`Healthcheck services: ${healthcheckServices.length}`);

  console.error('Step 13: Detecting version check services...');
  // Version checks should run for all changed services, not just ones being built
  // Extract unique build context directories (multiple services may share same build context)
  const versionCheckBuildContexts = new Set<string>();
  services
    .filter((s) => changedServices.includes(s.service_name) || affectedServices.includes(s.service_name))
    .filter(needsVersionCheck)
    .forEach((s) => {
      // Extract directory name from build_context (e.g., "docker/modbus-serial" -> "modbus-serial")
      const parts = s.build_context.split('/');
      const directory = parts[parts.length - 1];
      if (directory) {
        versionCheckBuildContexts.add(directory);
      }
    });
  const versionCheckServices = Array.from(versionCheckBuildContexts).sort();
  console.error(`Version check services: ${versionCheckServices.length}`);

  return {
    base_images: baseImages.map((img) => img.directory).sort(),
    changed_base_images: changedBaseImages.sort(),
    base_images_needed: baseImagesNeeded,
    unused_base_images: unusedBaseImages,
    changed_services: changedServices.sort(),
    affected_services: affectedServices,
    to_build: toBuild,
    to_retag: toRetag,
    to_pull_for_testing: toPullForTesting.sort(),
    testable_services: testableServices,
    healthcheck_services: healthcheckServices,
    version_check_services: versionCheckServices,
  };
}

const program = new Command();

program
  .name('detect-changes')
  .description('Detect Docker image changes and dependencies')
  .version('1.0.0')
  .requiredOption('--base-ref <ref>', 'Git reference to compare against')
  .option('--base-images-dir <path>', 'Path to base-images directory', 'base-images')
  .option('--compose-file <path>', 'Path to docker-compose.yml', 'docker-compose.yml')
  .option('--env-file <path>', 'Path to .env file', 'example.env')
  .option('--docker-dir <path>', 'Path to docker directory', 'docker')
  .option('--is-fork', 'Whether this is a fork PR')
  .requiredOption('--output-file <path>', 'Path to output file for GitHub Actions')
  .requiredOption('--base-sha <sha>', 'Git SHA to use for image tags')
  .action(async (options: CliOptions) => {
    try {
      console.error('=== Docker Change Detection ===');
      console.error(`Base ref: ${options.baseRef}`);
      console.error(`Base SHA: ${options.baseSha}`);
      console.error(`Is fork: ${options.isFork || false}`);
      console.error('');

      // Run detection workflow
      const result = await detectChanges(options);

      // Step 14: Generate outputs
      console.error('Step 14: Generating GitHub Actions outputs...');
      const outputs = convertToGitHubOutputs(result);

      // Step 15: Write to output file
      console.error('Step 15: Writing outputs to file...');
      const outputLines = Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      writeFileSync(options.outputFile, outputLines + '\n');

      console.error('');
      console.error('=== Detection Summary ===');
      console.error(`Base images changed: ${result.changed_base_images.length}`);
      console.error(`Base images unused: ${result.unused_base_images.length}`);
      console.error(`Services changed: ${result.changed_services.length}`);
      console.error(`Services affected: ${result.affected_services.length}`);
      console.error(`Total to build: ${result.to_build.length}`);
      console.error(`Total to retag: ${result.to_retag.length}`);
      console.error('');
      console.error(`Output written to: ${options.outputFile}`);

      process.exit(0);
    } catch (error) {
      console.error('');
      console.error('=== Error ===');
      console.error('Error detecting changes:', error);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
