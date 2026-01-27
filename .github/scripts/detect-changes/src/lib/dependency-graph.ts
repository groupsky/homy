/**
 * Dependency graph construction and affected service detection.
 *
 * This module builds reverse dependency mappings from services to base images
 * and detects which services are affected when base images change.
 *
 * Key responsibilities:
 * 1. Parse service Dockerfiles to extract base image dependencies
 * 2. Build reverse dependency map: base_image_dir -> [services]
 * 3. Detect affected services when base images change
 * 4. Handle multi-stage Dockerfiles by following stage chains
 * 5. Filter out non-GHCR base images
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractFinalStageBase } from './dockerfile-parser.js';
import type { Service, DirectoryGHCRMapping } from './types.js';

/**
 * Build a reverse dependency map from base image directories to services.
 *
 * Scans all service Dockerfiles to extract base image dependencies and creates
 * a mapping from base image directory to the list of services that depend on it.
 *
 * @param services - List of services to analyze
 * @param dockerDir - Docker directory path (e.g., 'docker')
 * @param baseImageMapping - Bidirectional mapping between base image directories and GHCR tags
 * @returns Map from base image directory to sorted array of service names
 *
 * @remarks
 * - Only tracks GHCR base images (ghcr.io/groupsky/homy/*)
 * - For multi-stage Dockerfiles, uses the final stage's base image
 * - Handles missing or malformed Dockerfiles gracefully
 * - Returns sorted arrays for deterministic output
 *
 * @example
 * ```typescript
 * const services = [
 *   { service_name: 'automations', dockerfile_path: 'docker/automations/Dockerfile' }
 * ];
 * const mapping = {
 *   dir_to_ghcr: { 'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine' },
 *   ghcr_to_dir: { 'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine' }
 * };
 * const result = buildReverseDependencyMap(services, 'docker', mapping);
 * // Returns: Map { 'node-18-alpine' => ['automations'] }
 * ```
 */
export function buildReverseDependencyMap(
  services: Service[],
  _dockerDir: string,
  baseImageMapping: DirectoryGHCRMapping
): Map<string, string[]> {
  const reverseDeps = new Map<string, Set<string>>();

  for (const service of services) {
    try {
      // Read the Dockerfile
      const dockerfilePath = path.resolve(service.dockerfile_path);
      const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf-8');

      // Extract the final stage base image
      const finalBaseImage = extractFinalStageBase(dockerfileContent);

      if (!finalBaseImage) {
        // No FROM line found, skip
        continue;
      }

      // Check if this is a GHCR base image we track
      // Only consider ghcr.io/groupsky/homy/* images, not ghcr.io/home-assistant/*
      if (!finalBaseImage.startsWith('ghcr.io/groupsky/homy/')) {
        continue;
      }

      // Look up the base image directory from the GHCR tag
      const baseDir = baseImageMapping.ghcr_to_dir[finalBaseImage];

      if (!baseDir) {
        // Base image not in our mapping, skip
        continue;
      }

      // Add service to the reverse dependency map
      if (!reverseDeps.has(baseDir)) {
        reverseDeps.set(baseDir, new Set<string>());
      }
      reverseDeps.get(baseDir)!.add(service.service_name);
    } catch (error) {
      // Handle missing or malformed Dockerfile gracefully
      // Just skip this service
      continue;
    }
  }

  // Convert Sets to sorted arrays for deterministic output
  const result = new Map<string, string[]>();
  for (const [baseDir, serviceSet] of reverseDeps.entries()) {
    result.set(baseDir, Array.from(serviceSet).sort());
  }

  return result;
}

/**
 * Detect services affected by base image changes.
 *
 * Given a list of changed base image directories and a reverse dependency map,
 * returns the list of services that need to be rebuilt.
 *
 * @param changedBaseDirs - List of base image directories that changed
 * @param reverseDeps - Reverse dependency map from buildReverseDependencyMap()
 * @param baseImageMapping - Bidirectional mapping between base image directories and GHCR tags
 * @returns Sorted, deduplicated array of affected service names
 *
 * @remarks
 * - Services are deduplicated (a service appears once even if multiple dependencies changed)
 * - Result is sorted for deterministic output
 * - Returns empty array if no services are affected
 *
 * @example
 * ```typescript
 * const changedBaseDirs = ['node-18-alpine'];
 * const reverseDeps = new Map([
 *   ['node-18-alpine', ['automations', 'mqtt-influx']]
 * ]);
 * const result = detectAffectedServices(changedBaseDirs, reverseDeps, {});
 * // Returns: ['automations', 'mqtt-influx']
 * ```
 */
export function detectAffectedServices(
  changedBaseDirs: string[],
  reverseDeps: Map<string, string[]>,
  _baseImageMapping: DirectoryGHCRMapping
): string[] {
  const affectedServices = new Set<string>();

  for (const baseDir of changedBaseDirs) {
    const services = reverseDeps.get(baseDir);
    if (services) {
      for (const service of services) {
        affectedServices.add(service);
      }
    }
  }

  // Return sorted array for deterministic output
  return Array.from(affectedServices).sort();
}
