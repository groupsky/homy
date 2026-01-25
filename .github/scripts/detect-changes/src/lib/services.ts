/**
 * Service discovery module for docker-compose.yml parsing.
 *
 * This module provides functionality to discover and extract metadata from services
 * defined in docker-compose.yml files. It uses `docker compose config` to parse
 * the compose file with environment variable substitution and extracts service
 * information including build context, dockerfile paths, and build arguments.
 */

import { execSync } from 'child_process';
import type { Service } from './types.js';

/**
 * Represents the structure of docker-compose config output.
 */
interface ComposeConfig {
  services: Record<string, ServiceConfig>;
}

/**
 * Represents a service configuration from docker-compose.yml.
 */
interface ServiceConfig {
  image?: string;
  build?: string | BuildConfig;
}

/**
 * Represents build configuration in docker-compose.yml.
 */
interface BuildConfig {
  context: string;
  dockerfile?: string | null;
  args?: Record<string, string> | null;
}

/**
 * Discovers services from docker-compose.yml using `docker compose config`.
 *
 * This function executes `docker compose config --format json` to get the parsed
 * compose configuration with all environment variable substitutions applied.
 * It then extracts metadata for all services that have a build directive.
 *
 * @param composeFile Path to docker-compose.yml file
 * @param envFile Path to .env file for environment variable substitution
 * @returns Array of discovered services with their metadata
 * @throws Error if docker compose command fails or returns invalid JSON
 *
 * @example
 * ```typescript
 * const services = discoverServicesFromCompose('docker-compose.yml', '.env');
 * console.log(services[0].service_name); // 'broker'
 * console.log(services[0].build_context); // 'docker/mosquitto'
 * ```
 */
export function discoverServicesFromCompose(composeFile: string, envFile: string): Service[] {
  const command = `docker compose --env-file ${envFile} --file ${composeFile} config --format json`;

  try {
    // Execute docker compose config and capture JSON output
    const output = execSync(command, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large compose files
    });

    // Parse JSON output
    const config: ComposeConfig = JSON.parse(output);

    // Extract metadata for all services
    const services: Service[] = [];
    for (const [serviceName, serviceConfig] of Object.entries(config.services || {})) {
      const metadata = extractServiceMetadata(serviceName, serviceConfig);
      if (metadata !== null) {
        services.push(metadata);
      }
    }

    return services;
  } catch (error) {
    // Re-throw with context for better error messages
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to discover services: ${String(error)}`);
  }
}

/**
 * Extracts service metadata from docker-compose service configuration.
 *
 * This function parses the service configuration object and extracts relevant
 * metadata including service name, image, build context, dockerfile path, and
 * build arguments. It handles both short build syntax (build: "path") and
 * long build syntax (build: { context, dockerfile, args }).
 *
 * @param serviceName Name of the service in docker-compose.yml
 * @param serviceConfig Service configuration object from docker-compose
 * @returns Service metadata object, or null if service has no build directive
 *
 * @example
 * ```typescript
 * const config = {
 *   image: 'ghcr.io/groupsky/homy/mosquitto:latest',
 *   build: { context: 'docker/mosquitto' }
 * };
 * const metadata = extractServiceMetadata('broker', config);
 * console.log(metadata.dockerfile_path); // 'docker/mosquitto/Dockerfile'
 * ```
 */
export function extractServiceMetadata(
  serviceName: string,
  serviceConfig: ServiceConfig
): Service | null {
  // Skip services without build directive
  if (!serviceConfig.build) {
    return null;
  }

  let buildContext: string;
  let dockerfilePath: string;
  let buildArgs: Record<string, string> | undefined;

  // Handle short build syntax: build: "docker/path"
  if (typeof serviceConfig.build === 'string') {
    buildContext = serviceConfig.build;
    dockerfilePath = normalizePath(buildContext, 'Dockerfile');
    buildArgs = undefined;
  } else {
    // Handle long build syntax: build: { context, dockerfile, args }
    buildContext = serviceConfig.build.context;

    // Resolve dockerfile path
    const dockerfile = serviceConfig.build.dockerfile || 'Dockerfile';
    dockerfilePath = normalizePath(buildContext, dockerfile);

    // Extract build args (filter out empty objects and null)
    const args = serviceConfig.build.args;
    if (args && typeof args === 'object' && Object.keys(args).length > 0) {
      buildArgs = args;
    } else {
      buildArgs = undefined;
    }
  }

  return {
    service_name: serviceName,
    image: serviceConfig.image,
    build_context: buildContext,
    dockerfile_path: dockerfilePath,
    build_args: buildArgs,
  };
}

/**
 * Filters services to only those using GHCR base images or with build directives.
 *
 * This function filters the services array to include only:
 * 1. Services with images starting with 'ghcr.io/groupsky/homy/'
 * 2. Services with images starting with 'ghcr.io/home-assistant/' (allowed exception)
 * 3. Services without an image field but with a build directive (local builds)
 *
 * @param services Array of services to filter
 * @returns Filtered array containing only GHCR-based services
 *
 * @example
 * ```typescript
 * const services = [
 *   { service_name: 'broker', image: 'ghcr.io/groupsky/homy/mosquitto:latest', ... },
 *   { service_name: 'postgres', image: 'postgres:15', ... }
 * ];
 * const filtered = filterGhcrServices(services);
 * console.log(filtered.length); // 1 (only broker)
 * ```
 */
export function filterGhcrServices(services: Service[]): Service[] {
  return services.filter((service) => {
    // Include services without image field (local builds with build directive)
    if (!service.image) {
      return true;
    }

    // Include services using GHCR base images
    if (service.image.startsWith('ghcr.io/groupsky/homy/')) {
      return true;
    }

    // Include Home Assistant images (allowed exception)
    if (service.image.startsWith('ghcr.io/home-assistant/')) {
      return true;
    }

    // Exclude all other images
    return false;
  });
}

/**
 * Normalizes a file path by joining context and filename.
 *
 * This helper function ensures consistent path formatting by:
 * 1. Removing trailing slashes from context
 * 2. Joining context and filename with a single forward slash
 *
 * @param context Build context directory path
 * @param filename Dockerfile name or relative path
 * @returns Normalized path joining context and filename
 *
 * @example
 * ```typescript
 * normalizePath('docker/app', 'Dockerfile'); // 'docker/app/Dockerfile'
 * normalizePath('docker/app/', 'Dockerfile'); // 'docker/app/Dockerfile'
 * normalizePath('docker', 'app/Dockerfile'); // 'docker/app/Dockerfile'
 * ```
 */
function normalizePath(context: string, filename: string): string {
  // Remove trailing slash from context
  const normalizedContext = context.replace(/\/$/, '');

  // Join with filename
  return `${normalizedContext}/${filename}`;
}
