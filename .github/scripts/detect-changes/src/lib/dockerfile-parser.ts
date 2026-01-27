/**
 * Dockerfile parsing and dependency extraction.
 *
 * Parses Dockerfile content to extract:
 * - Base image references (FROM statements)
 * - HEALTHCHECK instructions and parameters
 * - External image dependencies (COPY --from)
 * - Validation rules (no ARG in FROM)
 * - Base image upstream information
 */

import { DockerfileParser, From, Healthcheck, Copy } from 'dockerfile-ast';

/**
 * Custom error class for Dockerfile validation failures.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Represents a FROM instruction with parsed components.
 */
export interface FromInstruction {
  /** The base image name */
  image: string;
  /** The stage name if using AS keyword (optional) */
  stage: string | null;
  /** The platform if using --platform flag (optional) */
  platform: string | null;
}

/**
 * Represents HEALTHCHECK parameters extracted from Dockerfile.
 */
export interface HealthcheckParams {
  /** Health check interval duration */
  interval: string | null;
  /** Health check timeout duration */
  timeout: string | null;
  /** Start period before health checks begin */
  start_period: string | null;
  /** Number of retries before marking unhealthy */
  retries: string | null;
  /** The command to execute for health check */
  cmd: string | null;
}

/**
 * Represents parsed base image information.
 */
export interface BaseImageInfo {
  /** Full upstream image reference */
  upstream_image: string;
  /** Just the image name (without registry/tag) */
  image_name: string;
  /** The version tag, or null if not specified */
  version_tag: string | null;
}

/**
 * Extract all FROM lines from a Dockerfile.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @returns List of FROM instructions with image, stage, and platform information
 *
 * @example
 * ```typescript
 * parseFromLines('FROM node:18 AS base')
 * // Returns: [{ image: 'node:18', stage: 'base', platform: null }]
 * ```
 */
export function parseFromLines(dockerfileContent: string): FromInstruction[] {
  if (!dockerfileContent || !dockerfileContent.trim()) {
    return [];
  }

  const parser = DockerfileParser.parse(dockerfileContent);
  const result: FromInstruction[] = [];

  for (const instruction of parser.getInstructions()) {
    if (instruction.getKeyword().toUpperCase() === 'FROM') {
      const fromInstruction = instruction as From;

      // Get the full image string including registry
      const imageRange = fromInstruction.getImageRange();
      if (!imageRange) {
        continue; // Malformed
      }

      // Extract the full image name from the content
      const content = dockerfileContent.split('\n');
      const startLine = imageRange.start.line;
      const startChar = imageRange.start.character;
      const endLine = imageRange.end.line;
      const endChar = imageRange.end.character;

      let image: string;
      if (startLine === endLine) {
        image = content[startLine].substring(startChar, endChar);
      } else {
        // Multi-line (unlikely for image name, but handle it)
        const lines = content.slice(startLine, endLine + 1);
        lines[0] = lines[0].substring(startChar);
        lines[lines.length - 1] = lines[lines.length - 1].substring(0, endChar);
        image = lines.join('\n');
      }

      // Get build stage name
      const stage = fromInstruction.getBuildStage() || null;

      // Get platform flag
      const platformFlag = fromInstruction.getPlatformFlag();
      const platform = platformFlag ? platformFlag.getValue() : null;

      result.push({
        image,
        stage,
        platform,
      });
    }
  }

  return result;
}

/**
 * Extract the ultimate external base image for the final stage.
 *
 * Follows internal stage references to find the actual external base image.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @returns The external base image used by the final stage, or null if not found
 *
 * @example
 * ```typescript
 * extractFinalStageBase('FROM node:18 AS base\nFROM base AS final')
 * // Returns: 'node:18'
 * ```
 */
export function extractFinalStageBase(dockerfileContent: string): string | null {
  const fromLines = parseFromLines(dockerfileContent);

  if (fromLines.length === 0) {
    return null;
  }

  // Build a map of stage names to their base images
  const stageMap = new Map<string, string>();
  for (const fromLine of fromLines) {
    if (fromLine.stage) {
      stageMap.set(fromLine.stage, fromLine.image);
    }
  }

  // Get the final stage's image
  const finalImage = fromLines[fromLines.length - 1].image;

  // Follow the chain to find the external base
  const visited = new Set<string>();
  let current = finalImage;

  while (stageMap.has(current) && !visited.has(current)) {
    visited.add(current);
    current = stageMap.get(current)!;
  }

  return current;
}

/**
 * Check if the final stage has a HEALTHCHECK instruction.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @returns True if HEALTHCHECK exists in final stage, False otherwise
 *
 * @remarks
 * HEALTHCHECK NONE is treated as disabled (returns false)
 */
export function hasHealthcheck(dockerfileContent: string): boolean {
  if (!dockerfileContent) {
    return false;
  }

  const parser = DockerfileParser.parse(dockerfileContent);
  const instructions = parser.getInstructions();

  // Find the last FROM instruction to identify final stage
  let lastFromIdx = -1;
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].getKeyword().toUpperCase() === 'FROM') {
      lastFromIdx = i;
    }
  }

  if (lastFromIdx === -1) {
    return false;
  }

  // Look for HEALTHCHECK after the last FROM
  for (let i = lastFromIdx + 1; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (instruction.getKeyword().toUpperCase() === 'HEALTHCHECK') {
      const healthcheck = instruction as Healthcheck;
      const value = healthcheck.getArgumentsContent()?.trim() || '';
      // HEALTHCHECK NONE disables health checks
      if (value.toUpperCase() === 'NONE') {
        return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Extract HEALTHCHECK parameters from the final stage.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @returns Dictionary with interval, timeout, start_period, retries, and cmd, or null if not found
 *
 * @example
 * ```typescript
 * parseHealthcheckParams('FROM node\nHEALTHCHECK --interval=30s CMD echo ok')
 * // Returns: { interval: '30s', timeout: null, start_period: null, retries: null, cmd: 'echo ok' }
 * ```
 */
export function parseHealthcheckParams(dockerfileContent: string): HealthcheckParams | null {
  if (!dockerfileContent) {
    return null;
  }

  const parser = DockerfileParser.parse(dockerfileContent);
  const instructions = parser.getInstructions();

  // Find the last FROM instruction to identify final stage
  let lastFromIdx = -1;
  for (let i = 0; i < instructions.length; i++) {
    if (instructions[i].getKeyword().toUpperCase() === 'FROM') {
      lastFromIdx = i;
    }
  }

  if (lastFromIdx === -1) {
    return null;
  }

  // Look for HEALTHCHECK after the last FROM
  for (let i = lastFromIdx + 1; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (instruction.getKeyword().toUpperCase() === 'HEALTHCHECK') {
      const healthcheck = instruction as Healthcheck;

      // Get the subcommand (CMD or NONE)
      const subcommand = healthcheck.getSubcommand();
      if (subcommand && subcommand.getValue().toUpperCase() === 'NONE') {
        return null;
      }

      const result: HealthcheckParams = {
        interval: null,
        timeout: null,
        start_period: null,
        retries: null,
        cmd: null,
      };

      // Extract flags using the getFlags() method
      const flags = healthcheck.getFlags();
      if (flags) {
        for (const flag of flags) {
          const name = flag.getName();
          const value = flag.getValue();

          if (name === 'interval') {
            result.interval = value;
          } else if (name === 'timeout') {
            result.timeout = value;
          } else if (name === 'start-period') {
            result.start_period = value;
          } else if (name === 'retries') {
            result.retries = value;
          }
        }
      }

      // Get the CMD part
      const argsContent = healthcheck.getArgumentsContent()?.trim();
      if (argsContent && argsContent.toUpperCase().startsWith('CMD ')) {
        result.cmd = argsContent.substring(4).trim();
      } else if (argsContent && !argsContent.toUpperCase().startsWith('NONE')) {
        // If there's content but doesn't start with CMD, it might still be the command
        result.cmd = argsContent;
      }

      return result;
    }
  }

  return null;
}

/**
 * Extract external images used in COPY --from statements.
 *
 * Internal stage references are filtered out.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @returns List of unique external image names
 *
 * @example
 * ```typescript
 * extractCopyFromExternal('COPY --from=node:18 /app /app')
 * // Returns: ['node:18']
 * ```
 */
export function extractCopyFromExternal(dockerfileContent: string): string[] {
  if (!dockerfileContent) {
    return [];
  }

  const parser = DockerfileParser.parse(dockerfileContent);

  // Get all stage names to filter them out
  const fromLines = parseFromLines(dockerfileContent);
  const stageNames = new Set(fromLines.filter((line) => line.stage).map((line) => line.stage!));

  const externalImages = new Set<string>();

  for (const instruction of parser.getInstructions()) {
    if (instruction.getKeyword().toUpperCase() === 'COPY') {
      const copyInstruction = instruction as Copy;

      // Use the getFromFlag() method to extract --from value
      const fromFlag = copyInstruction.getFromFlag();
      if (fromFlag) {
        const image = fromFlag.getValue();
        // Only include if it's not an internal stage
        if (image && !stageNames.has(image)) {
          externalImages.add(image);
        }
      }
    }
  }

  return Array.from(externalImages);
}

/**
 * Validate that FROM lines don't use ARG variables.
 *
 * Throws ValidationError if variable substitution is detected in FROM.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @throws {ValidationError} If ARG variable is used in FROM line
 *
 * @example
 * ```typescript
 * validateNoArgInFrom('FROM node:18')  // OK
 * validateNoArgInFrom('FROM node:${VERSION}')  // Throws ValidationError
 * ```
 */
export function validateNoArgInFrom(dockerfileContent: string): void {
  const fromLines = parseFromLines(dockerfileContent);

  for (const fromLine of fromLines) {
    const image = fromLine.image;

    // Check for variable substitution patterns
    if (image.includes('$')) {
      throw new ValidationError(
        `FROM line contains variable substitution: ${image}. ARG variables in FROM statements are not allowed.`
      );
    }
  }
}

/**
 * Parse a base image Dockerfile to extract upstream image information.
 *
 * This is used for base-images/ directory Dockerfiles to track upstream images.
 *
 * @param dockerfileContent - The Dockerfile content as a string
 * @returns Dictionary with upstream_image, image_name, and version_tag, or null if not found
 *
 * @example
 * ```typescript
 * parseBaseDockerfile('FROM node:18.20.8-alpine')
 * // Returns: { upstream_image: 'node:18.20.8-alpine', image_name: 'node', version_tag: '18.20.8-alpine' }
 * ```
 */
export function parseBaseDockerfile(dockerfileContent: string): BaseImageInfo | null {
  const fromLines = parseFromLines(dockerfileContent);

  if (fromLines.length === 0) {
    return null;
  }

  // Use the first external FROM (skip internal stage references)
  let upstreamImage: string | null = null;
  for (const fromLine of fromLines) {
    const image = fromLine.image;
    // If it doesn't look like a stage reference (no dots, slashes, or colons typically means it's a stage)
    // But actually, we should just use the first one since base images are simple
    upstreamImage = image;
    break;
  }

  if (!upstreamImage) {
    return null;
  }

  // Parse the image name and tag
  // Format: [registry/]image[:tag]

  // Remove registry if present
  let imageWithoutRegistry = upstreamImage;
  if (upstreamImage.includes('/')) {
    const parts = upstreamImage.split('/');
    // Check if first part looks like a registry (has dot or is localhost)
    if (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost') {
      // This is a registry, remove it
      imageWithoutRegistry = parts.slice(1).join('/');
    } else {
      // Not a registry, keep as is
      imageWithoutRegistry = upstreamImage;
    }
  }

  // Extract version tag
  let imageName: string;
  let versionTag: string | null;

  if (imageWithoutRegistry.includes(':')) {
    const lastColonIdx = imageWithoutRegistry.lastIndexOf(':');
    imageName = imageWithoutRegistry.substring(0, lastColonIdx);
    versionTag = imageWithoutRegistry.substring(lastColonIdx + 1);
  } else {
    imageName = imageWithoutRegistry;
    versionTag = null;
  }

  // For images with registry, use the part after registry for image_name
  if (upstreamImage.includes('/')) {
    const parts = upstreamImage.split('/');
    if (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost') {
      // Has registry
      const rest = parts.slice(1).join('/');
      if (rest.includes(':')) {
        const lastColonIdx = rest.lastIndexOf(':');
        imageName = rest.substring(0, lastColonIdx);
      } else {
        imageName = rest;
      }
    }
  }

  return {
    upstream_image: upstreamImage,
    image_name: imageName,
    version_tag: versionTag,
  };
}
