/**
 * Base image discovery and mapping.
 *
 * Discovers all base images from base-images/ directory and builds mappings
 * between directory names and GHCR image tags. Handles special cases like
 * node-*-alpine directories and platform version normalization.
 *
 * Key functions:
 * - discoverBaseImages: Discover all base image directories with Dockerfiles
 * - parseBaseDockerfile: Parse Dockerfile to extract upstream image info
 * - normalizeGhcrTag: Convert directory name + version to GHCR tag format
 * - buildDirectoryToGhcrMapping: Build bidirectional dir<->GHCR mapping
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parseBaseDockerfile as dockerfileParserParseBaseDockerfile } from './dockerfile-parser.js';
import { normalizeVersion } from './version-normalizer.js';
import type { BaseImage, BaseImageInfo, DirectoryGHCRMapping } from './types.js';

/**
 * Get base image targets from docker-bake.hcl using Docker Buildx.
 *
 * Uses `docker buildx bake --print` to parse the HCL file and extract
 * the list of targets in the "default" group. This is the authoritative
 * source of truth for what gets built in CI.
 *
 * @param baseImagesDir - Path to the base-images directory containing docker-bake.hcl
 * @returns Array of target names from the default group
 * @throws Error if docker buildx is not installed or HCL parsing fails
 *
 * @example
 * ```typescript
 * const targets = getTargetsFromDockerBake('/path/to/base-images');
 * // Returns: ['node-18-alpine', 'grafana', 'influxdb', ...]
 * ```
 */
export function getTargetsFromDockerBake(baseImagesDir: string): string[] {
  try {
    const output = execSync('docker buildx bake --print', {
      cwd: baseImagesDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const parsed = JSON.parse(output);
    return (parsed.group?.default?.targets || []).sort();
  } catch (error: any) {
    if (error.message?.includes('command not found') || error.message?.includes('not recognized')) {
      throw new Error(
        'Docker Buildx is required but not installed. ' +
          'See: https://docs.docker.com/buildx/working-with-buildx/'
      );
    }
    throw new Error(`Failed to parse docker-bake.hcl: ${error.message}`);
  }
}

/**
 * Discover all base images in the base-images directory.
 *
 * Uses docker-bake.hcl as the source of truth for what base images exist,
 * then validates that corresponding directories and Dockerfiles exist.
 * This ensures consistency between the HCL file and the filesystem.
 *
 * @param baseImagesDir - Path to the base-images directory
 * @returns Array of discovered base images with metadata
 * @throws Error if validation fails (missing directories, orphaned directories, etc.)
 *
 * @example
 * ```typescript
 * const baseImages = discoverBaseImages('/path/to/base-images');
 * // Returns: [
 * //   { directory: 'node-18-alpine', dockerfile_path: '...', upstream_image: 'node:18.20.8-alpine3.21', ... },
 * //   { directory: 'grafana', dockerfile_path: '...', upstream_image: 'grafana/grafana:9.5.21', ... }
 * // ]
 * ```
 */
export function discoverBaseImages(baseImagesDir: string): BaseImage[] {
  const baseImages: BaseImage[] = [];

  // Check if docker-bake.hcl exists
  const dockerBakeHclPath = path.join(baseImagesDir, 'docker-bake.hcl');
  const hasDockerBakeHcl = fs.existsSync(dockerBakeHclPath);

  let targets: string[] = [];
  let validateBidirectionally = false;

  if (hasDockerBakeHcl) {
    // Use docker-bake.hcl as source of truth (production path)
    try {
      targets = getTargetsFromDockerBake(baseImagesDir);
      validateBidirectionally = true;
    } catch (error) {
      // Fall back to directory scanning if docker buildx fails
      console.error(`Warning: Failed to parse docker-bake.hcl, falling back to directory scanning: ${error}`);
      targets = [];
      validateBidirectionally = false;
    }
  }

  if (targets.length === 0) {
    // Fallback: scan directories (for tests and backward compatibility)
    targets = fs
      .readdirSync(baseImagesDir)
      .filter((entry) => {
        const entryPath = path.join(baseImagesDir, entry);
        const stat = fs.statSync(entryPath);
        if (!stat.isDirectory()) {
          return false;
        }
        return fs.existsSync(path.join(entryPath, 'Dockerfile'));
      })
      .sort();
    validateBidirectionally = false;
  }

  // Bidirectional validation (only if using docker-bake.hcl)
  if (validateBidirectionally) {
    const directoriesWithDockerfiles = fs
      .readdirSync(baseImagesDir)
      .filter((entry) => {
        const entryPath = path.join(baseImagesDir, entry);
        const stat = fs.statSync(entryPath);
        if (!stat.isDirectory()) {
          return false;
        }
        return fs.existsSync(path.join(entryPath, 'Dockerfile'));
      })
      .sort();

    const orphaned = directoriesWithDockerfiles.filter((dir) => !targets.includes(dir));
    const missing = targets.filter((target) => !directoriesWithDockerfiles.includes(target));

    if (orphaned.length > 0) {
      throw new Error(
        `Orphaned base image directories found (exist but not in docker-bake.hcl): ${orphaned.join(', ')}\n` +
          'Please either:\n' +
          '  1. Add these to docker-bake.hcl if they should be built, or\n' +
          '  2. Remove these directories if they are no longer needed'
      );
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing base image directories (in docker-bake.hcl but no directory exists): ${missing.join(', ')}\n` +
          'Please either:\n' +
          '  1. Create the missing directories with Dockerfiles, or\n' +
          '  2. Remove these targets from docker-bake.hcl'
      );
    }
  }

  // Process all targets
  for (const target of targets) {
    const entryPath = path.join(baseImagesDir, target);
    const dockerfilePath = path.join(entryPath, 'Dockerfile');

    // Parse the Dockerfile
    let info: BaseImageInfo | null = null;
    try {
      info = parseBaseDockerfile(dockerfilePath);
    } catch (error) {
      if (validateBidirectionally) {
        // Parsing failure is an error for targets in docker-bake.hcl
        throw new Error(`Failed to parse Dockerfile for target "${target}": ${error}`);
      }
      // Skip directories where Dockerfile cannot be parsed (backward compatibility)
      continue;
    }

    if (!info) {
      if (validateBidirectionally) {
        throw new Error(`Failed to parse Dockerfile for target "${target}": No valid FROM line found`);
      }
      // Skip if parsing failed (backward compatibility)
      continue;
    }

    // Create base image entry
    const baseImage: BaseImage = {
      directory: target,
      dockerfile_path: dockerfilePath,
      upstream_image: info.upstream_image,
      image_name: info.image_name,
      raw_version: info.version_tag || undefined,
    };

    baseImages.push(baseImage);
  }

  return baseImages;
}

/**
 * Parse a base image Dockerfile to extract upstream image information.
 *
 * Reads and parses a Dockerfile to extract the upstream image reference,
 * image name, and version tag. This is a wrapper around the dockerfile-parser
 * module's parseBaseDockerfile function.
 *
 * @param dockerfilePath - Absolute path to the Dockerfile
 * @returns Parsed base image info, or null if parsing fails
 *
 * @example
 * ```typescript
 * const info = parseBaseDockerfile('/path/to/node-18-alpine/Dockerfile');
 * // Returns: {
 * //   upstream_image: 'node:18.20.8-alpine3.21',
 * //   image_name: 'node',
 * //   version_tag: '18.20.8-alpine3.21'
 * // }
 * ```
 */
export function parseBaseDockerfile(dockerfilePath: string): BaseImageInfo | null {
  // Read Dockerfile content
  const content = fs.readFileSync(dockerfilePath, 'utf-8');

  // Use existing dockerfile-parser module
  const parsed = dockerfileParserParseBaseDockerfile(content);

  if (!parsed) {
    return null;
  }

  // Convert from dockerfile-parser's BaseImageInfo (version_tag: string | null)
  // to types.ts BaseImageInfo (version_tag?: string)
  return {
    upstream_image: parsed.upstream_image,
    image_name: parsed.image_name,
    version_tag: parsed.version_tag || undefined,
  };
}

/**
 * Normalize a GHCR tag from directory name and raw version.
 *
 * Maps base image directory names to their GHCR tag format, with special
 * handling for node-*-alpine directories and platform version normalization.
 *
 * Mapping rules (GHCR format, not upstream format):
 * - node-18-alpine + "18.20.8-alpine3.21" -> "node:18.20.8-alpine"
 * - node-22-alpine + "22.22.0-alpine3.23" -> "node:22.22.0-alpine"
 * - grafana + "9.5.21" -> "grafana:9.5.21" (upstream is grafana/grafana, GHCR flattens to grafana)
 * - alpine + "3.22.1" -> "alpine:3.22.1"
 * - Empty/null version -> ":latest"
 *
 * @param directoryName - Base image directory name (e.g., "node-18-alpine")
 * @param rawVersion - Raw version from upstream image (e.g., "18.20.8-alpine3.21")
 * @returns Normalized GHCR tag (e.g., "node:18.20.8-alpine")
 *
 * @example
 * ```typescript
 * normalizeGhcrTag('node-18-alpine', '18.20.8-alpine3.21')
 * // Returns: 'node:18.20.8-alpine'
 *
 * normalizeGhcrTag('grafana', '9.5.21')
 * // Returns: 'grafana:9.5.21'
 * ```
 */
export function normalizeGhcrTag(directoryName: string, rawVersion: string): string {
  // Handle null/undefined version
  let version = rawVersion;
  if (!version || version === null || version === undefined) {
    version = 'latest';
  }

  // Normalize platform-specific versions (alpine3.21 -> alpine, debian12 -> debian, etc.)
  const normalizedVersion = normalizeVersion(version);

  // Special handling for node-*-alpine directories
  if (directoryName.startsWith('node-') && directoryName.endsWith('-alpine')) {
    // Extract just "node" as the image name
    return `node:${normalizedVersion}`;
  }

  // Special handling for node-ubuntu directory
  // GHCR publishes as ghcr.io/groupsky/homy/node-ubuntu:*, not node:*
  if (directoryName === 'node-ubuntu') {
    return `node-ubuntu:${normalizedVersion}`;
  }

  // GHCR images are published with flattened names (e.g., ghcr.io/groupsky/homy/grafana:*)
  // even if upstream uses org/image format (e.g., grafana/grafana:*).
  // Always use the directory name as the GHCR image name.
  return `${directoryName}:${normalizedVersion}`;
}

/**
 * Build bidirectional mapping between directory names and GHCR tags.
 *
 * Creates two mappings:
 * 1. dir_to_ghcr: Maps directory names to GHCR tags
 * 2. ghcr_to_dir: Maps GHCR tags back to directory names (inverse)
 *
 * This allows efficient lookup in both directions for dependency resolution.
 *
 * @param baseImagesDir - Path to the base-images directory
 * @returns Bidirectional mapping object
 *
 * @example
 * ```typescript
 * const mapping = buildDirectoryToGhcrMapping('/path/to/base-images');
 * // Returns: {
 * //   dir_to_ghcr: {
 * //     'node-18-alpine': 'node:18.20.8-alpine',
 * //     'grafana': 'grafana:9.5.21'
 * //   },
 * //   ghcr_to_dir: {
 * //     'node:18.20.8-alpine': 'node-18-alpine',
 * //     'grafana:9.5.21': 'grafana'
 * //   }
 * // }
 * ```
 */
export function buildDirectoryToGhcrMapping(baseImagesDir: string): DirectoryGHCRMapping {
  const dirToGhcr: Record<string, string> = {};
  const ghcrToDir: Record<string, string> = {};

  // Discover all base images
  const baseImages = discoverBaseImages(baseImagesDir);

  // Build mappings
  for (const baseImage of baseImages) {
    const normalizedTag = normalizeGhcrTag(baseImage.directory, baseImage.raw_version || '');
    const rawVersion = baseImage.raw_version || '';

    // Map directory to normalized tag
    dirToGhcr[baseImage.directory] = normalizedTag;

    // Map normalized tag to directory
    ghcrToDir[normalizedTag] = baseImage.directory;

    // ALSO map raw version tag to directory (if different from normalized)
    // This handles cases where services use the full upstream version
    // E.g., node:22.22.0-alpine3.23 maps to node-22-alpine directory
    if (rawVersion) {
      // Extract the image name from the normalized tag (before the colon)
      const colonIndex = normalizedTag.indexOf(':');
      if (colonIndex !== -1) {
        const imageName = normalizedTag.substring(0, colonIndex);
        const rawTag = `${imageName}:${rawVersion}`;

        if (rawTag !== normalizedTag) {
          ghcrToDir[rawTag] = baseImage.directory;
        }
      }
    }
  }

  return {
    dir_to_ghcr: dirToGhcr,
    ghcr_to_dir: ghcrToDir,
  };
}
