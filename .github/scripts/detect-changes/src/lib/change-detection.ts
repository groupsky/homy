/**
 * Git-based change detection for base images and services.
 *
 * This module provides utilities to:
 * 1. Detect changed base image directories via git diff
 * 2. Detect changed service directories via git diff
 * 3. Validate base images are exact copies (FROM+LABEL only)
 */

import { execFileSync as defaultExecFileSync } from 'child_process';
import { readFileSync as defaultReadFileSync } from 'fs';
import { DockerfileParser } from 'dockerfile-ast';
import type { BaseImage, Service } from './types.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Find the git repository root directory.
 * Git commands must be run from the repository root for pathspecs to work correctly.
 */
function getGitRoot(execFileSync: typeof defaultExecFileSync = defaultExecFileSync): string {
  const output = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  }) as string;
  return output.trim();
}

/**
 * Dependencies that can be injected for testing.
 * @internal
 */
export interface ChangeDetectionDeps {
  execFileSync?: typeof defaultExecFileSync;
  readFileSync?: typeof defaultReadFileSync;
}

/**
 * Detect changed base image directories via git diff.
 *
 * Compares the current HEAD against the specified base ref to find which
 * base image directories have been modified.
 *
 * @param baseRef - Git reference to compare against (e.g., 'origin/master', 'main')
 * @param baseImages - List of discovered base images with their directories
 * @param deps - Optional dependencies for testing
 * @returns Array of base image directory names that have changed
 *
 * @example
 * ```typescript
 * const changed = detectChangedBaseImages('origin/master', baseImages);
 * // Returns: ['node-18-alpine', 'grafana-9']
 * ```
 *
 * @throws Error if git command fails (e.g., bad revision reference)
 */
export function detectChangedBaseImages(
  baseRef: string,
  baseImages: BaseImage[],
  deps: ChangeDetectionDeps = {}
): string[] {
  const { execFileSync = defaultExecFileSync } = deps;

  if (baseImages.length === 0) {
    return [];
  }

  // Build a set of known base image directories for filtering
  const knownDirs = new Set(baseImages.map((img) => img.directory));

  // Get repository root - git commands must run from repo root for pathspecs to work
  const repoRoot = getGitRoot(execFileSync);

  // Run git diff to get changed files in base-images/
  let output: string;

  try {
    output = execFileSync('git', ['diff', '--name-only', baseRef, 'HEAD', '--', 'base-images/'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    }) as string;
  } catch (error) {
    // Re-throw git errors (e.g., bad revision)
    throw error;
  }

  if (!output.trim()) {
    return [];
  }

  // Parse changed paths and extract directory names
  const changedDirs = new Set<string>();

  for (const line of output.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    // Expected format: base-images/<directory>/<file>
    const parts = trimmedLine.split('/');
    if (parts.length >= 2 && parts[0] === 'base-images') {
      const directory = parts[1];

      // Only include if it's a known base image directory
      if (directory && knownDirs.has(directory)) {
        changedDirs.add(directory);
      }
    }
  }

  return Array.from(changedDirs);
}

/**
 * Detect changed service directories via git diff.
 *
 * Compares the current HEAD against the specified base ref to find which
 * service directories have been modified.
 *
 * @param baseRef - Git reference to compare against (e.g., 'origin/master', 'main')
 * @param services - List of discovered services with their directories
 * @param deps - Optional dependencies for testing
 * @returns Array of service names that have changed
 *
 * @example
 * ```typescript
 * const changed = detectChangedServices('origin/master', services);
 * // Returns: ['automations', 'mqtt-influx']
 * ```
 *
 * @throws Error if git command fails (e.g., bad revision reference)
 */
export function detectChangedServices(
  baseRef: string,
  services: Service[],
  deps: ChangeDetectionDeps = {}
): string[] {
  const { execFileSync = defaultExecFileSync } = deps;

  if (services.length === 0) {
    return [];
  }

  // Build a map of build context directories to service names
  const dirToService = new Map<string, string>();
  for (const service of services) {
    // Extract directory name from build_context path
    // Format: /repo/docker/<service-name>
    const parts = service.build_context.split('/');
    const directory = parts[parts.length - 1];
    if (directory) {
      dirToService.set(directory, service.service_name);
    }
  }

  // Get repository root - git commands must run from repo root for pathspecs to work
  // CRITICAL: Git pathspecs are relative to repo root, but execFileSync runs from cwd
  // Running from subdirectories (like .github/scripts/detect-changes) breaks pathspecs
  const repoRoot = getGitRoot(execFileSync);

  // Run git diff to get changed files in docker/
  // IMPORTANT: Use 'docker/' not 'docker/STAR/' - the glob pattern doesn't work as expected
  // with git pathspecs. 'docker/' matches all files recursively, but glob patterns do not.
  // See tests/integration/git-pathspec.integration.test.ts for detailed explanation.
  let output: string;

  try {
    output = execFileSync('git', ['diff', '--name-only', baseRef, 'HEAD', '--', 'docker/'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    }) as string;
  } catch (error) {
    // Re-throw git errors (e.g., bad revision)
    throw error;
  }

  if (!output.trim()) {
    return [];
  }

  // Parse changed paths and extract service names
  const changedServices = new Set<string>();

  for (const line of output.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    // Expected format: docker/<service-name>/<file>
    const parts = trimmedLine.split('/');
    if (parts.length >= 2 && parts[0] === 'docker') {
      const directory = parts[1];

      // Look up service name from directory
      const serviceName = dirToService.get(directory);
      if (serviceName) {
        changedServices.add(serviceName);
      }
    }
  }

  return Array.from(changedServices);
}

/**
 * Validate that a base image Dockerfile is an exact copy.
 *
 * Base images must only contain FROM and LABEL instructions to ensure they
 * are exact copies of upstream images without modifications.
 *
 * @param dockerfilePath - Absolute path to the Dockerfile to validate
 * @param deps - Optional dependencies for testing
 *
 * @throws {ValidationError} If Dockerfile contains disallowed instructions
 * @throws {ValidationError} If Dockerfile doesn't have exactly one FROM
 * @throws {Error} If file cannot be read
 *
 * @example
 * ```typescript
 * validateBaseImageExactCopy('/repo/base-images/node-18-alpine/Dockerfile');
 * // Passes for: FROM node:18\nLABEL maintainer="admin"
 * // Throws for: FROM node:18\nRUN apk add git
 * ```
 */
export function validateBaseImageExactCopy(
  dockerfilePath: string,
  deps: ChangeDetectionDeps = {}
): void {
  const { readFileSync = defaultReadFileSync } = deps;

  // Read Dockerfile content
  let content: string;
  try {
    content = readFileSync(dockerfilePath, 'utf-8') as string;
  } catch (error) {
    // Re-throw file read errors
    throw error;
  }

  // Parse Dockerfile
  const parser = DockerfileParser.parse(content);
  const instructions = parser.getInstructions();

  // Count FROM instructions
  let fromCount = 0;
  const disallowedInstructions: string[] = [];

  for (const instruction of instructions) {
    const keyword = instruction.getKeyword().toUpperCase();

    if (keyword === 'FROM') {
      fromCount++;
    } else if (keyword === 'LABEL') {
      // LABEL is allowed
      continue;
    } else {
      // Any other instruction is disallowed
      disallowedInstructions.push(keyword);
    }
  }

  // Validate exactly one FROM
  if (fromCount !== 1) {
    throw new ValidationError(
      `Base image Dockerfile must have exactly one FROM instruction, found ${fromCount}: ${dockerfilePath}`
    );
  }

  // Validate no disallowed instructions
  if (disallowedInstructions.length > 0) {
    throw new ValidationError(
      `Base image Dockerfile must be an exact copy (FROM + LABEL only). ` +
        `Found disallowed instructions: ${disallowedInstructions.join(', ')} in ${dockerfilePath}`
    );
  }
}
