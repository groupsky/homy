/**
 * GHCR (GitHub Container Registry) client for image existence checks.
 *
 * Provides functionality for:
 * - Checking if Docker images exist in GHCR using docker buildx imagetools inspect
 * - Batch checking multiple services against GHCR
 * - Validating fork PRs have required base images
 * - Retry logic with exponential backoff for transient errors
 * - Error handling for rate limits and network issues
 */

import { execSync } from 'child_process';
import { GHCRError, GHCRRateLimitError, ValidationError } from '../utils/errors.js';
import type { Service } from './types.js';

/**
 * Default GHCR registry prefix for the project.
 */
const DEFAULT_REGISTRY = 'ghcr.io/groupsky/homy';

/**
 * Sleep for specified milliseconds.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a Docker image exists in GHCR using docker buildx imagetools inspect.
 *
 * Uses exponential backoff retry strategy:
 * - First retry: 1 second delay
 * - Second retry: 2 seconds delay
 * - Third retry: 4 seconds delay
 * - etc.
 *
 * Does not retry on:
 * - "manifest unknown" errors (image definitely doesn't exist)
 *
 * Throws GHCRRateLimitError on:
 * - 503 Service Unavailable errors (rate limit hit)
 *
 * @param imageTag - Full image tag (e.g., 'ghcr.io/groupsky/homy/node:18.20.8-alpine')
 * @param retries - Number of retry attempts on transient errors (default: 0)
 * @returns Promise resolving to true if image exists, false if not found
 * @throws {GHCRRateLimitError} When GHCR rate limit is hit (503 errors)
 * @throws {GHCRError} When other errors occur and retries are exhausted
 *
 * @example
 * ```typescript
 * // Check without retries
 * const exists = await checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine');
 *
 * // Check with retries for transient errors
 * const exists = await checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine', 3);
 * ```
 */
export async function checkImageExists(imageTag: string, retries: number = 0): Promise<boolean> {
  const command = `docker buildx imagetools inspect ${imageTag}`;
  const maxAttempts = retries === 0 ? 1 : retries; // retries=0 means 1 attempt, retries=2 means 2 attempts

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Execute docker buildx imagetools inspect
      execSync(command, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // If successful, image exists
      return true;
    } catch (error: unknown) {
      const err = error as Error & { status?: number; code?: string };
      const errorMessage = err.message || '';

      // Check for "manifest unknown" - image doesn't exist, no retry needed
      if (errorMessage.includes('manifest unknown')) {
        return false;
      }

      // Check for rate limit (503 errors)
      if (errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
        throw new GHCRRateLimitError(
          `GHCR rate limit hit while checking ${imageTag}: ${errorMessage}`
        );
      }

      // If this was the last attempt, throw error
      if (attempt >= maxAttempts - 1) {
        throw new GHCRError(
          `Failed to check image ${imageTag} after ${attempt + 1} attempt(s): ${errorMessage}`
        );
      }

      // Otherwise, wait and retry with exponential backoff
      const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, etc.
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new GHCRError(`Unexpected error checking image ${imageTag}`);
}

/**
 * Batch check multiple services against GHCR to determine which need building vs retagging.
 *
 * Checks each service's image tag in GHCR:
 * - If image exists: add to toRetag (can reuse existing image)
 * - If image doesn't exist or service has no image property: add to toBuild
 *
 * Uses retry logic for each check to handle transient network errors.
 *
 * @param services - List of services to check
 * @param baseSha - Git SHA to use for image tags
 * @param registry - GHCR registry prefix (default: 'ghcr.io/groupsky/homy')
 * @returns Promise resolving to object with toBuild and toRetag service name arrays
 *
 * @example
 * ```typescript
 * const services = [
 *   { service_name: 'automations', image: 'ghcr.io/...', ... },
 *   { service_name: 'features', build_context: './docker/features', ... },
 * ];
 *
 * const result = await checkAllServices(services, 'abc123');
 * // result.toBuild: ['features']
 * // result.toRetag: ['automations']
 * ```
 */
export async function checkAllServices(
  services: Service[],
  baseSha: string,
  registry: string = DEFAULT_REGISTRY
): Promise<{ toBuild: string[]; toRetag: string[] }> {
  const toBuild: string[] = [];
  const toRetag: string[] = [];

  // Check each service
  for (const service of services) {
    // If service has no image property, it needs to be built
    if (!service.image) {
      const imageTag = `${registry}/${service.service_name}:${baseSha}`;
      const exists = await checkImageExists(imageTag, 3);

      if (exists) {
        toRetag.push(service.service_name);
      } else {
        toBuild.push(service.service_name);
      }
      continue;
    }

    // Check if the service's image exists in GHCR
    try {
      const exists = await checkImageExists(service.image, 3);

      if (exists) {
        toRetag.push(service.service_name);
      } else {
        toBuild.push(service.service_name);
      }
    } catch (error) {
      // On error, assume we need to build
      toBuild.push(service.service_name);
    }
  }

  return { toBuild, toRetag };
}

/**
 * Validate that a fork PR has all required base images available in GHCR.
 *
 * Fork PRs cannot build base images (lack permissions), so they must use
 * existing base images from the main repository.
 *
 * Skips validation if isFork is false (non-fork PRs can build base images).
 *
 * @param isFork - Whether this is a fork PR
 * @param baseImagesNeeded - List of base image tags needed (e.g., ['node:18.20.8-alpine'])
 * @throws {ValidationError} When fork PR is missing required base images
 *
 * @example
 * ```typescript
 * // Non-fork PR - validation skipped
 * await validateForkPrBaseImages(false, ['node:18.20.8-alpine']);
 *
 * // Fork PR - must have all base images
 * await validateForkPrBaseImages(true, ['node:18.20.8-alpine', 'alpine:3.22.1']);
 * // Throws ValidationError if any are missing
 * ```
 */
export async function validateForkPrBaseImages(
  isFork: boolean,
  baseImagesNeeded: string[]
): Promise<void> {
  // Skip validation for non-fork PRs
  if (!isFork) {
    return;
  }

  // Skip validation if no base images needed
  if (baseImagesNeeded.length === 0) {
    return;
  }

  const missingImages: string[] = [];

  // Check each base image
  for (const baseImage of baseImagesNeeded) {
    const imageTag = `${DEFAULT_REGISTRY}/${baseImage}`;

    try {
      const exists = await checkImageExists(imageTag, 3);

      if (!exists) {
        missingImages.push(baseImage);
      }
    } catch (error) {
      // If we can't check, assume it's missing
      missingImages.push(baseImage);
    }
  }

  // If any images are missing, raise validation error
  if (missingImages.length > 0) {
    const imageList = missingImages.map((img) => `  - ${img}`).join('\n');
    throw new ValidationError(
      `Fork PR is missing required base images in GHCR:\n${imageList}\n\n` +
        `Fork PRs cannot build base images. Please wait for the main repository ` +
        `to build these base images first, or rebase on a commit that has them.`
    );
  }
}
