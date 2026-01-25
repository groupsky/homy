/**
 * Test suite for ghcr-client module.
 *
 * This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
 * for the ghcr-client module BEFORE implementation. All tests will initially FAIL (red phase)
 * until the implementation is complete.
 *
 * The ghcr-client module is responsible for:
 * 1. Checking if Docker images exist in GHCR using docker buildx imagetools inspect
 * 2. Batch checking multiple services against GHCR
 * 3. Validating fork PRs have required base images
 * 4. Retry logic with exponential backoff for transient errors
 * 5. Error handling for rate limits and network issues
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { GHCRError, GHCRRateLimitError, ValidationError } from '../../src/utils/errors.js';
import type { Service } from '../../src/lib/types.js';

// Mock child_process module
const mockedExecSync = jest.fn<typeof import('child_process').execSync>();

jest.unstable_mockModule('child_process', () => ({
  execSync: mockedExecSync,
}));

// Import after mocking
const { checkImageExists, checkAllServices, validateForkPrBaseImages } = await import(
  '../../src/lib/ghcr-client.js'
);

describe('TestCheckImageExists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_image_exists_returns_true', () => {
    test('Should return true when docker buildx imagetools inspect succeeds', async () => {
      // Mock successful docker command
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      const result = await checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine');

      expect(result).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith(
        'docker buildx imagetools inspect ghcr.io/groupsky/homy/node:18.20.8-alpine',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    });
  });

  describe('test_image_not_found_returns_false', () => {
    test('Should return false when manifest unknown error occurs', async () => {
      // Mock manifest unknown error
      const error = new Error('manifest unknown') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const result = await checkImageExists('ghcr.io/groupsky/homy/nonexistent:latest');

      expect(result).toBe(false);
    });
  });

  describe('test_rate_limit_error_raises_ghcr_rate_limit_error', () => {
    test('Should raise GHCRRateLimitError on 503 errors', async () => {
      // Mock 503 rate limit error
      const error = new Error('503 Service Unavailable') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine')
      ).rejects.toThrow(GHCRRateLimitError);
    });
  });

  describe('test_retry_on_transient_errors', () => {
    test('Should retry 3 times with exponential backoff on transient errors', async () => {
      // Mock transient error that eventually succeeds
      let callCount = 0;
      mockedExecSync.mockImplementation((() => {
        callCount++;
        if (callCount < 3) {
          const error = new Error('temporary failure') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
        return 'Manifest: sha256:abc123...';
      }) as any);

      const result = await checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine', 3);

      expect(result).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledTimes(3);
    });
  });

  describe('test_retry_exhausted_raises_ghcr_error', () => {
    test('Should raise GHCRError when retries are exhausted', async () => {
      // Mock persistent error
      const error = new Error('persistent error') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine', 2)
      ).rejects.toThrow(GHCRError);

      // Should have tried 2 times
      expect(mockedExecSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('test_manifest_unknown_no_retry', () => {
    test('Should not retry on manifest unknown errors (image not found)', async () => {
      // Mock manifest unknown error
      const error = new Error('manifest unknown: manifest unknown') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const result = await checkImageExists('ghcr.io/groupsky/homy/nonexistent:latest', 3);

      expect(result).toBe(false);
      // Should only try once, not retry
      expect(mockedExecSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('test_exponential_backoff_timing', () => {
    test('Should use exponential backoff: 1s, 2s, 4s', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      mockedExecSync.mockImplementation((() => {
        callCount++;
        if (callCount < 4) {
          const error = new Error('temporary failure') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
        return 'Manifest: sha256:abc123...';
      }) as any);

      const promise = checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine', 4);

      // Fast-forward through delays
      await jest.advanceTimersByTimeAsync(1000); // First retry after 1s
      await jest.advanceTimersByTimeAsync(2000); // Second retry after 2s
      await jest.advanceTimersByTimeAsync(4000); // Third retry after 4s

      const result = await promise;
      expect(result).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('test_default_retries_is_zero', () => {
    test('Should not retry by default (retries=0)', async () => {
      const error = new Error('temporary failure') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine')
      ).rejects.toThrow(GHCRError);

      // Should only try once
      expect(mockedExecSync).toHaveBeenCalledTimes(1);
    });
  });
});

describe('TestCheckAllServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_all_services_exist_returns_empty_to_build', () => {
    test('Should return empty to_build when all services exist in GHCR', async () => {
      // Mock all images exist
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      const services: Service[] = [
        {
          service_name: 'automations',
          image: 'ghcr.io/groupsky/homy/automations:abc123',
          build_context: './docker/automations',
          dockerfile_path: './docker/automations/Dockerfile',
        },
        {
          service_name: 'features',
          image: 'ghcr.io/groupsky/homy/features:abc123',
          build_context: './docker/features',
          dockerfile_path: './docker/features/Dockerfile',
        },
      ];

      const result = await checkAllServices(services, 'abc123');

      expect(result.toBuild).toEqual([]);
      expect(result.toRetag).toEqual(['automations', 'features']);
    });
  });

  describe('test_some_services_missing_returns_to_build', () => {
    test('Should return services to build when images do not exist', async () => {
      // Mock first service exists, second does not
      let callCount = 0;
      mockedExecSync.mockImplementation(((cmd: any) => {
        callCount++;
        if (cmd.toString().includes('automations')) {
          return 'Manifest: sha256:abc123...';
        } else {
          const error = new Error('manifest unknown') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
      }) as any);

      const services: Service[] = [
        {
          service_name: 'automations',
          image: 'ghcr.io/groupsky/homy/automations:abc123',
          build_context: './docker/automations',
          dockerfile_path: './docker/automations/Dockerfile',
        },
        {
          service_name: 'features',
          image: 'ghcr.io/groupsky/homy/features:abc123',
          build_context: './docker/features',
          dockerfile_path: './docker/features/Dockerfile',
        },
      ];

      const result = await checkAllServices(services, 'abc123');

      expect(result.toBuild).toEqual(['features']);
      expect(result.toRetag).toEqual(['automations']);
    });
  });

  describe('test_services_without_image_added_to_build', () => {
    test('Should add services without image property to to_build', async () => {
      const services: Service[] = [
        {
          service_name: 'custom-service',
          build_context: './docker/custom-service',
          dockerfile_path: './docker/custom-service/Dockerfile',
        },
      ];

      const result = await checkAllServices(services, 'abc123');

      expect(result.toBuild).toEqual(['custom-service']);
      expect(result.toRetag).toEqual([]);
    });
  });

  describe('test_custom_registry_prefix', () => {
    test('Should use custom registry prefix when provided', async () => {
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      const services: Service[] = [
        {
          service_name: 'automations',
          build_context: './docker/automations',
          dockerfile_path: './docker/automations/Dockerfile',
        },
      ];

      await checkAllServices(services, 'abc123', 'custom.registry.io/org/homy');

      expect(mockedExecSync).toHaveBeenCalledWith(
        'docker buildx imagetools inspect custom.registry.io/org/homy/automations:abc123',
        expect.any(Object)
      );
    });
  });

  describe('test_default_registry_is_ghcr', () => {
    test('Should use ghcr.io/groupsky/homy as default registry', async () => {
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      const services: Service[] = [
        {
          service_name: 'automations',
          build_context: './docker/automations',
          dockerfile_path: './docker/automations/Dockerfile',
        },
      ];

      await checkAllServices(services, 'abc123');

      expect(mockedExecSync).toHaveBeenCalledWith(
        'docker buildx imagetools inspect ghcr.io/groupsky/homy/automations:abc123',
        expect.any(Object)
      );
    });
  });

  describe('test_batch_checking_with_retries', () => {
    test('Should check all services with retry logic', async () => {
      let callCount = 0;
      mockedExecSync.mockImplementation((() => {
        callCount++;
        // Fail first two attempts, then succeed
        if (callCount <= 2) {
          const error = new Error('temporary failure') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
        return 'Manifest: sha256:abc123...';
      }) as any);

      const services: Service[] = [
        {
          service_name: 'automations',
          image: 'ghcr.io/groupsky/homy/automations:abc123',
          build_context: './docker/automations',
          dockerfile_path: './docker/automations/Dockerfile',
        },
      ];

      const result = await checkAllServices(services, 'abc123');

      // Should eventually succeed after retries
      expect(result.toRetag).toContain('automations');
    });
  });
});

describe('TestValidateForkPrBaseImages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_non_fork_pr_skips_validation', () => {
    test('Should skip validation when isFork is false', async () => {
      await validateForkPrBaseImages(false, ['node:18.20.8-alpine', 'alpine:3.22.1']);

      // Should not call docker at all
      expect(mockedExecSync).not.toHaveBeenCalled();
    });
  });

  describe('test_fork_pr_with_all_base_images_passes', () => {
    test('Should pass validation when all base images exist', async () => {
      // Mock all images exist
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      await expect(
        validateForkPrBaseImages(true, [
          'node:18.20.8-alpine',
          'alpine:3.22.1',
        ])
      ).resolves.toBeUndefined();

      expect(mockedExecSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('test_fork_pr_with_missing_base_images_fails', () => {
    test('Should raise ValidationError when base images are missing', async () => {
      // Mock first image exists, second does not
      let callCount = 0;
      mockedExecSync.mockImplementation(((cmd: any) => {
        callCount++;
        if (cmd.toString().includes('node')) {
          return 'Manifest: sha256:abc123...';
        } else {
          const error = new Error('manifest unknown') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
      }) as any);

      await expect(
        validateForkPrBaseImages(true, [
          'node:18.20.8-alpine',
          'alpine:3.22.1',
        ])
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('test_fork_pr_validation_error_message', () => {
    test('Should provide helpful error message listing missing images', async () => {
      // Mock all images missing
      const error = new Error('manifest unknown') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        validateForkPrBaseImages(true, [
          'node:18.20.8-alpine',
          'alpine:3.22.1',
        ])
      ).rejects.toThrow(/node:18.20.8-alpine/);

      await expect(
        validateForkPrBaseImages(true, [
          'node:18.20.8-alpine',
          'alpine:3.22.1',
        ])
      ).rejects.toThrow(/alpine:3.22.1/);
    });
  });

  describe('test_fork_pr_with_empty_base_images_passes', () => {
    test('Should pass when no base images are needed', async () => {
      await expect(
        validateForkPrBaseImages(true, [])
      ).resolves.toBeUndefined();

      expect(mockedExecSync).not.toHaveBeenCalled();
    });
  });

  describe('test_fork_pr_prepends_ghcr_prefix', () => {
    test('Should prepend ghcr.io/groupsky/homy to base image names', async () => {
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      await validateForkPrBaseImages(true, ['node:18.20.8-alpine']);

      expect(mockedExecSync).toHaveBeenCalledWith(
        'docker buildx imagetools inspect ghcr.io/groupsky/homy/node:18.20.8-alpine',
        expect.any(Object)
      );
    });
  });
});

describe('TestGHCRClientEdgeCases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_empty_services_list', () => {
    test('Should handle empty services list gracefully', async () => {
      const result = await checkAllServices([], 'abc123');

      expect(result.toBuild).toEqual([]);
      expect(result.toRetag).toEqual([]);
      expect(mockedExecSync).not.toHaveBeenCalled();
    });
  });

  describe('test_network_timeout_error', () => {
    test('Should handle network timeout as transient error', async () => {
      const error = new Error('ETIMEDOUT') as Error & { status?: number; code?: string };
      error.status = 1;
      error.code = 'ETIMEDOUT';
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine', 2)
      ).rejects.toThrow(GHCRError);

      // Should retry on timeout
      expect(mockedExecSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('test_docker_not_installed', () => {
    test('Should raise GHCRError when docker is not installed', async () => {
      const error = new Error('docker: command not found') as Error & { status?: number };
      error.status = 127;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        checkImageExists('ghcr.io/groupsky/homy/node:18.20.8-alpine')
      ).rejects.toThrow(GHCRError);
    });
  });

  describe('test_malformed_image_tag', () => {
    test('Should handle malformed image tags gracefully', async () => {
      const error = new Error('invalid reference format') as Error & { status?: number };
      error.status = 1;
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      await expect(
        checkImageExists('invalid::image::tag')
      ).rejects.toThrow(GHCRError);
    });
  });

  describe('test_concurrent_service_checks', () => {
    test('Should handle concurrent checks efficiently', async () => {
      mockedExecSync.mockReturnValue('Manifest: sha256:abc123...');

      const services: Service[] = Array.from({ length: 10 }, (_, i) => ({
        service_name: `service-${i}`,
        image: `ghcr.io/groupsky/homy/service-${i}:abc123`,
        build_context: `./docker/service-${i}`,
        dockerfile_path: `./docker/service-${i}/Dockerfile`,
      }));

      const result = await checkAllServices(services, 'abc123');

      expect(result.toRetag).toHaveLength(10);
      expect(mockedExecSync).toHaveBeenCalledTimes(10);
    });
  });
});

describe('TestGHCRClientIntegration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_real_world_service_check_scenario', () => {
    test('Should handle realistic service checking scenario', async () => {
      // Simulate: automations exists, features doesn't, ha-discovery has no image
      mockedExecSync.mockImplementation(((cmd: any) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('automations')) {
          return 'Manifest: sha256:abc123...';
        } else {
          const error = new Error('manifest unknown') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
      }) as any);

      const services: Service[] = [
        {
          service_name: 'automations',
          image: 'ghcr.io/groupsky/homy/automations:abc123',
          build_context: './docker/automations',
          dockerfile_path: './docker/automations/Dockerfile',
        },
        {
          service_name: 'features',
          image: 'ghcr.io/groupsky/homy/features:abc123',
          build_context: './docker/features',
          dockerfile_path: './docker/features/Dockerfile',
        },
        {
          service_name: 'ha-discovery',
          build_context: './docker/ha-discovery',
          dockerfile_path: './docker/ha-discovery/Dockerfile',
        },
      ];

      const result = await checkAllServices(services, 'abc123');

      expect(result.toBuild).toEqual(['features', 'ha-discovery']);
      expect(result.toRetag).toEqual(['automations']);
    });
  });

  describe('test_fork_pr_complete_validation_flow', () => {
    test('Should validate fork PR with mixed base image availability', async () => {
      // Simulate some base images exist, others don't
      mockedExecSync.mockImplementation(((cmd: any) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node:18.20.8-alpine')) {
          return 'Manifest: sha256:abc123...';
        } else {
          const error = new Error('manifest unknown') as Error & { status?: number };
          error.status = 1;
          throw error;
        }
      }) as any);

      await expect(
        validateForkPrBaseImages(true, [
          'node:18.20.8-alpine',
          'python:3.11-alpine',
          'alpine:3.22.1',
        ])
      ).rejects.toThrow(ValidationError);
    });
  });
});
