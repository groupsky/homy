/**
 * Test suite for services module.
 *
 * This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
 * for the services module BEFORE implementation. All tests will initially FAIL (red phase)
 * until the implementation is complete.
 *
 * The services module is responsible for:
 * 1. Discovering services from docker-compose.yml using `docker compose config`
 * 2. Extracting service metadata (name, image, build context, dockerfile, build args)
 * 3. Filtering services to only those using GHCR base images or with build directives
 * 4. Handling multiple service instances (mqtt-influx-primary, mqtt-influx-secondary)
 * 5. Supporting custom dockerfile names and build arguments
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import type { Service } from '../../src/lib/types.js';

// Mock child_process module
const mockedExecSync = jest.fn<typeof import('child_process').execSync>();

jest.unstable_mockModule('child_process', () => ({
  execSync: mockedExecSync,
}));

// Import after mocking
const { discoverServicesFromCompose, extractServiceMetadata, filterGhcrServices } = await import(
  '../../src/lib/services.js'
);

describe('TestDiscoverServicesFromCompose', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_single_service_discovery', () => {
    test('Should discover single service with GHCR image and build context', () => {
      const composeConfig = {
        services: {
          broker: {
            image: 'ghcr.io/groupsky/homy/mosquitto:latest',
            build: {
              context: 'docker/mosquitto',
              dockerfile: 'Dockerfile',
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(mockedExecSync).toHaveBeenCalledWith(
        'docker compose --env-file .env --file docker-compose.yml config --format json',
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      expect(services).toHaveLength(1);
      expect(services[0]).toEqual({
        service_name: 'broker',
        image: 'ghcr.io/groupsky/homy/mosquitto:latest',
        build_context: 'docker/mosquitto',
        dockerfile_path: 'docker/mosquitto/Dockerfile',
        build_args: undefined,
      });
    });
  });

  describe('test_multiple_services_discovery', () => {
    test('Should discover multiple services from docker-compose.yml', () => {
      const composeConfig = {
        services: {
          broker: {
            image: 'ghcr.io/groupsky/homy/mosquitto:latest',
            build: {
              context: 'docker/mosquitto',
              dockerfile: 'Dockerfile',
            },
          },
          ha: {
            image: 'ghcr.io/groupsky/homy/homeassistant:latest',
            build: {
              context: 'docker/homeassistant',
              dockerfile: 'Dockerfile',
            },
          },
          automations: {
            image: 'ghcr.io/groupsky/homy/automations:latest',
            build: {
              context: 'docker/automations',
              dockerfile: 'Dockerfile',
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(3);
      expect(services.map((s) => s.service_name)).toEqual(['broker', 'ha', 'automations']);
    });
  });

  describe('test_service_with_build_args', () => {
    test('Should extract build arguments from service configuration', () => {
      const composeConfig = {
        services: {
          grafana: {
            image: 'ghcr.io/groupsky/homy/grafana:latest',
            build: {
              context: 'docker/grafana',
              dockerfile: 'Dockerfile',
              args: {
                GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
                BUILD_DATE: '2026-01-25',
              },
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      expect(services[0].build_args).toEqual({
        GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
        BUILD_DATE: '2026-01-25',
      });
    });
  });

  describe('test_service_with_custom_dockerfile', () => {
    test('Should handle custom dockerfile path in build configuration', () => {
      const composeConfig = {
        services: {
          'custom-service': {
            image: 'ghcr.io/groupsky/homy/custom:latest',
            build: {
              context: 'docker/custom',
              dockerfile: 'Dockerfile.prod',
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      expect(services[0].dockerfile_path).toBe('docker/custom/Dockerfile.prod');
    });
  });

  describe('test_multiple_instances_same_image', () => {
    test('Should handle multiple service instances using the same image', () => {
      const composeConfig = {
        services: {
          'mqtt-influx-primary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: {
              context: 'docker/mqtt-influx',
              dockerfile: 'Dockerfile',
            },
          },
          'mqtt-influx-secondary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: {
              context: 'docker/mqtt-influx',
              dockerfile: 'Dockerfile',
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(2);
      expect(services.map((s) => s.service_name)).toEqual([
        'mqtt-influx-primary',
        'mqtt-influx-secondary',
      ]);
      // Both should point to the same build context
      expect(services[0].build_context).toBe('docker/mqtt-influx');
      expect(services[1].build_context).toBe('docker/mqtt-influx');
    });
  });

  describe('test_service_with_short_build_syntax', () => {
    test('Should handle build as string (short syntax)', () => {
      const composeConfig = {
        services: {
          nginx: {
            image: 'ghcr.io/groupsky/homy/nginx:latest',
            build: 'docker/nginx',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      expect(services[0].build_context).toBe('docker/nginx');
      expect(services[0].dockerfile_path).toBe('docker/nginx/Dockerfile');
    });
  });

  describe('test_service_without_build_directive', () => {
    test('Should skip services without build directive', () => {
      const composeConfig = {
        services: {
          'external-db': {
            image: 'postgres:15',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(0);
    });
  });

  describe('test_service_without_image_but_with_build', () => {
    test('Should handle services with build but no explicit image', () => {
      const composeConfig = {
        services: {
          'local-service': {
            build: {
              context: 'docker/local-service',
              dockerfile: 'Dockerfile',
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      expect(services[0].service_name).toBe('local-service');
      expect(services[0].image).toBeUndefined();
      expect(services[0].build_context).toBe('docker/local-service');
    });
  });

  describe('test_execsync_command_failure', () => {
    test('Should throw error when docker compose config fails', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('docker compose not found');
      });

      expect(() => {
        discoverServicesFromCompose('docker-compose.yml', '.env');
      }).toThrow('docker compose not found');
    });
  });

  describe('test_invalid_json_output', () => {
    test('Should throw error when docker compose config returns invalid JSON', () => {
      mockedExecSync.mockReturnValue(Buffer.from('invalid json {'));

      expect(() => {
        discoverServicesFromCompose('docker-compose.yml', '.env');
      }).toThrow();
    });
  });

  describe('test_empty_services_object', () => {
    test('Should handle docker-compose.yml with no services', () => {
      const composeConfig = {
        services: {},
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(0);
    });
  });

  describe('test_custom_compose_file_path', () => {
    test('Should support custom docker-compose.yml path', () => {
      const composeConfig = {
        services: {
          app: {
            image: 'ghcr.io/groupsky/homy/app:latest',
            build: 'docker/app',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      discoverServicesFromCompose('custom/docker-compose.yml', 'custom.env');

      expect(mockedExecSync).toHaveBeenCalledWith(
        'docker compose --env-file custom.env --file custom/docker-compose.yml config --format json',
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
    });
  });
});

describe('TestExtractServiceMetadata', () => {
  describe('test_extract_metadata_with_all_fields', () => {
    test('Should extract all metadata from service configuration', () => {
      const serviceConfig = {
        image: 'ghcr.io/groupsky/homy/grafana:latest',
        build: {
          context: 'docker/grafana',
          dockerfile: 'Dockerfile',
          args: {
            GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
          },
        },
      };

      const metadata = extractServiceMetadata('grafana', serviceConfig);

      expect(metadata).not.toBeNull();
      expect(metadata!.service_name).toBe('grafana');
      expect(metadata!.image).toBe('ghcr.io/groupsky/homy/grafana:latest');
      expect(metadata!.build_context).toBe('docker/grafana');
      expect(metadata!.dockerfile_path).toBe('docker/grafana/Dockerfile');
      expect(metadata!.build_args).toEqual({
        GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
      });
    });
  });

  describe('test_extract_metadata_short_build_syntax', () => {
    test('Should extract metadata from short build syntax', () => {
      const serviceConfig = {
        image: 'ghcr.io/groupsky/homy/nginx:latest',
        build: 'docker/nginx',
      };

      const metadata = extractServiceMetadata('nginx', serviceConfig);

      expect(metadata).not.toBeNull();
      expect(metadata!.build_context).toBe('docker/nginx');
      expect(metadata!.dockerfile_path).toBe('docker/nginx/Dockerfile');
      expect(metadata!.build_args).toBeUndefined();
    });
  });

  describe('test_extract_metadata_no_build_directive', () => {
    test('Should return null for services without build directive', () => {
      const serviceConfig = {
        image: 'postgres:15',
      };

      const metadata = extractServiceMetadata('db', serviceConfig);

      expect(metadata).toBeNull();
    });
  });

  describe('test_extract_metadata_custom_dockerfile', () => {
    test('Should handle custom dockerfile path', () => {
      const serviceConfig = {
        build: {
          context: 'docker/app',
          dockerfile: 'Dockerfile.production',
        },
      };

      const metadata = extractServiceMetadata('app', serviceConfig);

      expect(metadata).not.toBeNull();
      expect(metadata!.dockerfile_path).toBe('docker/app/Dockerfile.production');
    });
  });

  describe('test_extract_metadata_no_image_field', () => {
    test('Should handle services without explicit image field', () => {
      const serviceConfig = {
        build: {
          context: 'docker/local',
        },
      };

      const metadata = extractServiceMetadata('local', serviceConfig);

      expect(metadata).not.toBeNull();
      expect(metadata!.image).toBeUndefined();
    });
  });

  describe('test_extract_metadata_empty_build_args', () => {
    test('Should handle empty build args object', () => {
      const serviceConfig = {
        image: 'ghcr.io/groupsky/homy/app:latest',
        build: {
          context: 'docker/app',
          args: {},
        },
      };

      const metadata = extractServiceMetadata('app', serviceConfig);

      expect(metadata).not.toBeNull();
      expect(metadata!.build_args).toBeUndefined();
    });
  });

  describe('test_extract_metadata_dockerfile_in_subdirectory', () => {
    test('Should handle dockerfile in subdirectory of context', () => {
      const serviceConfig = {
        build: {
          context: 'docker',
          dockerfile: 'app/Dockerfile',
        },
      };

      const metadata = extractServiceMetadata('app', serviceConfig);

      expect(metadata).not.toBeNull();
      expect(metadata!.build_context).toBe('docker');
      expect(metadata!.dockerfile_path).toBe('docker/app/Dockerfile');
    });
  });
});

describe('TestFilterGhcrServices', () => {
  describe('test_filter_only_ghcr_services', () => {
    test('Should keep only services using ghcr.io/groupsky/homy/ images', () => {
      const services: Service[] = [
        {
          service_name: 'broker',
          image: 'ghcr.io/groupsky/homy/mosquitto:latest',
          build_context: 'docker/mosquitto',
          dockerfile_path: 'docker/mosquitto/Dockerfile',
        },
        {
          service_name: 'postgres',
          image: 'postgres:15',
          build_context: 'docker/postgres',
          dockerfile_path: 'docker/postgres/Dockerfile',
        },
        {
          service_name: 'ha',
          image: 'ghcr.io/groupsky/homy/homeassistant:latest',
          build_context: 'docker/homeassistant',
          dockerfile_path: 'docker/homeassistant/Dockerfile',
        },
      ];

      const filtered = filterGhcrServices(services);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((s) => s.service_name)).toEqual(['broker', 'ha']);
    });
  });

  describe('test_filter_allows_home_assistant_images', () => {
    test('Should allow ghcr.io/home-assistant/ images through filter', () => {
      const services: Service[] = [
        {
          service_name: 'ha',
          image: 'ghcr.io/home-assistant/home-assistant:latest',
          build_context: 'docker/homeassistant',
          dockerfile_path: 'docker/homeassistant/Dockerfile',
        },
      ];

      const filtered = filterGhcrServices(services);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].service_name).toBe('ha');
    });
  });

  describe('test_filter_includes_services_without_image', () => {
    test('Should include services with build but no image field', () => {
      const services: Service[] = [
        {
          service_name: 'local-app',
          build_context: 'docker/local-app',
          dockerfile_path: 'docker/local-app/Dockerfile',
        },
        {
          service_name: 'broker',
          image: 'ghcr.io/groupsky/homy/mosquitto:latest',
          build_context: 'docker/mosquitto',
          dockerfile_path: 'docker/mosquitto/Dockerfile',
        },
      ];

      const filtered = filterGhcrServices(services);

      // Services without image field should be included since they have build directive
      expect(filtered).toHaveLength(2);
    });
  });

  describe('test_filter_excludes_non_ghcr_images', () => {
    test('Should exclude services using non-GHCR images', () => {
      const services: Service[] = [
        {
          service_name: 'redis',
          image: 'redis:7-alpine',
          build_context: 'docker/redis',
          dockerfile_path: 'docker/redis/Dockerfile',
        },
        {
          service_name: 'custom',
          image: 'docker.io/custom/app:latest',
          build_context: 'docker/custom',
          dockerfile_path: 'docker/custom/Dockerfile',
        },
      ];

      const filtered = filterGhcrServices(services);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('test_filter_empty_services_list', () => {
    test('Should handle empty services array', () => {
      const services: Service[] = [];

      const filtered = filterGhcrServices(services);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('test_filter_preserves_metadata', () => {
    test('Should preserve build args and other metadata', () => {
      const services: Service[] = [
        {
          service_name: 'grafana',
          image: 'ghcr.io/groupsky/homy/grafana:latest',
          build_context: 'docker/grafana',
          dockerfile_path: 'docker/grafana/Dockerfile',
          build_args: {
            GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
          },
        },
      ];

      const filtered = filterGhcrServices(services);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].build_args).toEqual({
        GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
      });
    });
  });
});

describe('TestServicesIntegration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_full_workflow_with_real_compose_structure', () => {
    test('Should handle complete docker-compose.yml structure', () => {
      const composeConfig = {
        services: {
          broker: {
            image: 'ghcr.io/groupsky/homy/mosquitto:latest',
            build: 'docker/mosquitto',
          },
          ha: {
            image: 'ghcr.io/groupsky/homy/homeassistant:latest',
            build: 'docker/homeassistant',
          },
          'mqtt-influx-primary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: 'docker/mqtt-influx',
          },
          'mqtt-influx-secondary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: 'docker/mqtt-influx',
          },
          grafana: {
            image: 'ghcr.io/groupsky/homy/grafana:latest',
            build: {
              context: 'docker/grafana',
              args: {
                GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
              },
            },
          },
          postgres: {
            image: 'postgres:15',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const allServices = discoverServicesFromCompose('docker-compose.yml', '.env');
      const ghcrServices = filterGhcrServices(allServices);

      expect(ghcrServices).toHaveLength(5);
      expect(ghcrServices.map((s) => s.service_name)).toEqual([
        'broker',
        'ha',
        'mqtt-influx-primary',
        'mqtt-influx-secondary',
        'grafana',
      ]);

      // Verify grafana has build args
      const grafana = ghcrServices.find((s) => s.service_name === 'grafana');
      expect(grafana?.build_args).toEqual({
        GF_INSTALL_IMAGE_RENDERER_PLUGIN: 'false',
      });

      // Verify multiple instances share same build context
      const primaryInflux = ghcrServices.find((s) => s.service_name === 'mqtt-influx-primary');
      const secondaryInflux = ghcrServices.find((s) => s.service_name === 'mqtt-influx-secondary');
      expect(primaryInflux?.build_context).toBe('docker/mqtt-influx');
      expect(secondaryInflux?.build_context).toBe('docker/mqtt-influx');
    });
  });

  describe('test_deduplicate_by_build_context', () => {
    test('Should identify unique services by build context', () => {
      const composeConfig = {
        services: {
          'mqtt-influx-primary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: 'docker/mqtt-influx',
          },
          'mqtt-influx-secondary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: 'docker/mqtt-influx',
          },
          'mqtt-influx-tertiary': {
            image: 'ghcr.io/groupsky/homy/mqtt-influx:latest',
            build: 'docker/mqtt-influx',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      // All three services should be discovered
      expect(services).toHaveLength(3);

      // Get unique build contexts
      const uniqueContexts = new Set(services.map((s) => s.build_context));
      expect(uniqueContexts.size).toBe(1);
      expect(uniqueContexts.has('docker/mqtt-influx')).toBe(true);
    });
  });
});

describe('TestServicesEdgeCases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_service_with_null_values', () => {
    test('Should handle null values in service configuration', () => {
      const composeConfig = {
        services: {
          app: {
            image: 'ghcr.io/groupsky/homy/app:latest',
            build: {
              context: 'docker/app',
              dockerfile: null,
              args: null,
            },
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      expect(services[0].dockerfile_path).toBe('docker/app/Dockerfile');
      expect(services[0].build_args).toBeUndefined();
    });
  });

  describe('test_service_name_with_special_characters', () => {
    test('Should handle service names with hyphens and underscores', () => {
      const composeConfig = {
        services: {
          'my-service_name-123': {
            image: 'ghcr.io/groupsky/homy/app:latest',
            build: 'docker/app',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      expect(services[0].service_name).toBe('my-service_name-123');
    });
  });

  describe('test_build_context_with_trailing_slash', () => {
    test('Should handle build context with trailing slash', () => {
      const composeConfig = {
        services: {
          app: {
            build: 'docker/app/',
          },
        },
      };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const services = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(services).toHaveLength(1);
      // Should normalize or handle trailing slash
      expect(services[0].build_context).toMatch(/docker\/app\/?$/);
    });
  });

  describe('test_large_number_of_services', () => {
    test('Should handle docker-compose with many services', () => {
      const services: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        services[`service-${i}`] = {
          image: `ghcr.io/groupsky/homy/app-${i}:latest`,
          build: `docker/app-${i}`,
        };
      }

      const composeConfig = { services };

      mockedExecSync.mockReturnValue(Buffer.from(JSON.stringify(composeConfig)));

      const discoveredServices = discoverServicesFromCompose('docker-compose.yml', '.env');

      expect(discoveredServices).toHaveLength(100);
    });
  });
});
