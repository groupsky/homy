/**
 * Shared TypeScript types for detect-changes tooling.
 */

/**
 * Represents a parsed FROM instruction from a Dockerfile.
 */
export interface FromLine {
  /** The base image reference (e.g., 'node:18.20.8-alpine') */
  image: string;
  /** Optional stage name if using AS keyword */
  stage?: string;
  /** Optional platform if using --platform flag */
  platform?: string;
}

/**
 * Represents HEALTHCHECK parameters from a Dockerfile.
 */
export interface HealthcheckParams {
  /** Healthcheck interval (e.g., '30s') */
  interval?: string;
  /** Healthcheck timeout (e.g., '5s') */
  timeout?: string;
  /** Startup period before checks begin (e.g., '10s') */
  start_period?: string;
  /** Number of retries before considering unhealthy */
  retries?: string;
  /** The healthcheck command to run */
  cmd?: string;
}

/**
 * Represents parsed upstream image information from a base image Dockerfile.
 */
export interface BaseImageInfo {
  /** Full upstream image reference (e.g., 'node:18.20.8-alpine3.21') */
  upstream_image: string;
  /** Image name without registry/tag (e.g., 'node') */
  image_name: string;
  /** Version tag from upstream image (e.g., '18.20.8-alpine3.21') */
  version_tag?: string;
}

/**
 * Represents a discovered base image with its metadata.
 */
export interface BaseImage {
  /** Directory name (e.g., 'node-18-alpine') */
  directory: string;
  /** Path to the Dockerfile */
  dockerfile_path: string;
  /** Full upstream image reference */
  upstream_image: string;
  /** Image name without registry/tag */
  image_name: string;
  /** Raw version tag from upstream image */
  raw_version?: string;
}

/**
 * Represents a service discovered from docker-compose.yml.
 */
export interface Service {
  /** Name of the service in docker-compose.yml */
  service_name: string;
  /** Full GHCR image path */
  image?: string;
  /** Path to build directory */
  build_context: string;
  /** Resolved Dockerfile path */
  dockerfile_path: string;
  /** Build arguments if present */
  build_args?: Record<string, string>;
}

/**
 * Bidirectional mapping between base image directories and GHCR tags.
 */
export interface DirectoryGHCRMapping {
  /** Maps directory name to GHCR tag */
  dir_to_ghcr: Record<string, string>;
  /** Maps GHCR tag to directory name */
  ghcr_to_dir: Record<string, string>;
}

/**
 * Detection results for change detection logic.
 */
export interface DetectionResult {
  /** All discovered base images */
  base_images: string[];
  /** Base images that have changed */
  changed_base_images: string[];
  /** Base images that need to be built */
  base_images_needed: string[];
  /** Base images not referenced by any service */
  unused_base_images: string[];
  /** Services that have changed */
  changed_services: string[];
  /** Services affected by base image changes */
  affected_services: string[];
  /** Services that need to be built */
  to_build: string[];
  /** Services that can be retagged */
  to_retag: string[];
  /** Services with tests that should be run */
  testable_services: string[];
  /** Services with healthchecks that should be validated */
  healthcheck_services: string[];
  /** Services that need version consistency checks */
  version_check_services: string[];
}

/**
 * GitHub Actions output format.
 */
export type GitHubActionsOutputs = Record<string, string>;
