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
import { parseBaseDockerfile as dockerfileParserParseBaseDockerfile } from './dockerfile-parser.js';
import { normalizeVersion } from './version-normalizer.js';
import type { BaseImage, BaseImageInfo, DirectoryGHCRMapping } from './types.js';

/**
 * Discover all base images in the base-images directory.
 *
 * Scans the base-images directory for subdirectories containing Dockerfiles
 * and parses each to extract upstream image information.
 *
 * @param baseImagesDir - Path to the base-images directory
 * @returns Array of discovered base images with metadata
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

  // Read all entries in base-images directory
  const entries = fs.readdirSync(baseImagesDir);

  for (const entry of entries) {
    const entryPath = path.join(baseImagesDir, entry);

    // Check if entry is a directory
    const stat = fs.statSync(entryPath);
    if (!stat.isDirectory()) {
      continue;
    }

    // Check if directory contains a Dockerfile
    const dockerfilePath = path.join(entryPath, 'Dockerfile');
    if (!fs.existsSync(dockerfilePath)) {
      continue;
    }

    // Parse the Dockerfile
    let info: BaseImageInfo | null = null;
    try {
      info = parseBaseDockerfile(dockerfilePath);
    } catch (error) {
      // Skip directories where Dockerfile cannot be parsed
      continue;
    }

    if (!info) {
      // Skip if parsing failed
      continue;
    }

    // Create base image entry
    const baseImage: BaseImage = {
      directory: entry,
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
 * Mapping rules:
 * - node-18-alpine + "18.20.8-alpine3.21" -> "node:18.20.8-alpine"
 * - node-22-alpine + "22.22.0-alpine3.23" -> "node:22.22.0-alpine"
 * - grafana + "9.5.21" -> "grafana/grafana:9.5.21"
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
 * // Returns: 'grafana/grafana:9.5.21'
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
  if (directoryName === 'node-ubuntu') {
    return `node:${normalizedVersion}`;
  }

  // Special handling for known images with org/image format
  const imageOrgMappings: Record<string, string> = {
    grafana: 'grafana/grafana',
    nodered: 'nodered/node-red',
  };

  if (imageOrgMappings[directoryName]) {
    return `${imageOrgMappings[directoryName]}:${normalizedVersion}`;
  }

  // Default: use directory name as image name
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
 * //     'grafana': 'grafana/grafana:9.5.21'
 * //   },
 * //   ghcr_to_dir: {
 * //     'node:18.20.8-alpine': 'node-18-alpine',
 * //     'grafana/grafana:9.5.21': 'grafana'
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
    const ghcrTag = normalizeGhcrTag(baseImage.directory, baseImage.raw_version || '');

    // Add to both mappings
    dirToGhcr[baseImage.directory] = ghcrTag;
    ghcrToDir[ghcrTag] = baseImage.directory;
  }

  return {
    dir_to_ghcr: dirToGhcr,
    ghcr_to_dir: ghcrToDir,
  };
}
