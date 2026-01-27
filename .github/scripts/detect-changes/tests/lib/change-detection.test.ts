/**
 * Test suite for change-detection module.
 *
 * This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
 * for the change-detection module BEFORE implementation. All tests will initially FAIL (red phase)
 * until the implementation is complete.
 *
 * The change-detection module is responsible for:
 * 1. Detecting changed base image directories via git diff
 * 2. Detecting changed service directories via git diff
 * 3. Validating base images are exact copies (FROM+LABEL only)
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import type { BaseImage, Service } from '../../src/lib/types.js';
import { ValidationError } from '../../src/utils/errors.js';
import {
  detectChangedBaseImages,
  detectChangedServices,
  validateBaseImageExactCopy,
} from '../../src/lib/change-detection.js';

// Mock functions with correct types
const mockExecFileSync = jest.fn() as any;
const mockReadFileSync = jest.fn() as jest.MockedFunction<typeof import('fs').readFileSync>;

describe('detectChangedBaseImages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should detect changed base images from git diff', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
        raw_version: '18.20.8-alpine',
      },
      {
        directory: 'grafana-9',
        dockerfile_path: '/repo/base-images/grafana-9/Dockerfile',
        upstream_image: 'grafana/grafana:9.5.21',
        image_name: 'grafana/grafana',
        raw_version: '9.5.21',
      },
      {
        directory: 'alpine-3',
        dockerfile_path: '/repo/base-images/alpine-3/Dockerfile',
        upstream_image: 'alpine:3.21',
        image_name: 'alpine',
        raw_version: '3.21',
      },
    ];

    // Mock getGitRoot call
    mockExecFileSync.mockReturnValueOnce('/repo');
    // Mock git diff output showing changes in node-18-alpine and grafana-9
    mockExecFileSync.mockReturnValueOnce(
      'base-images/node-18-alpine/Dockerfile\nbase-images/grafana-9/README.md\n'
    );

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['rev-parse', '--show-toplevel'],
      { encoding: 'utf-8' }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--name-only', 'origin/master', 'HEAD', '--', 'base-images/'],
      { cwd: '/repo', encoding: 'utf-8' }
    );
    expect(result).toEqual(['node-18-alpine', 'grafana-9']);
  });

  test('should return empty array when no base images changed', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
        raw_version: '18.20.8-alpine',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce('');

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(result).toEqual([]);
  });

  test('should handle base images with multiple file changes', () => {
    const baseRef = 'main';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce(
        'base-images/node-18-alpine/Dockerfile\nbase-images/node-18-alpine/README.md\nbase-images/node-18-alpine/.dockerignore\n'
    );

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['node-18-alpine']);
  });

  test('should deduplicate changed base images', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce(
        'base-images/node-18-alpine/Dockerfile\nbase-images/node-18-alpine/README.md\n'
    );

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['node-18-alpine']);
  });

  test('should only return known base image directories', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
      },
    ];

    // Git diff shows changes including unknown directory
    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce(
        'base-images/node-18-alpine/Dockerfile\nbase-images/unknown-image/Dockerfile\n'
    );

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['node-18-alpine']);
  });

  test('should handle empty base images list', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [];

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(result).toEqual([]);
  });

  test('should throw error when git command fails', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('fatal: bad revision \'origin/master\'');
    });

    expect(() => detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync })).toThrow(
      'fatal: bad revision \'origin/master\''
    );
  });

  test('should handle paths with trailing slashes', () => {
    const baseRef = 'origin/master';
    const baseImages: BaseImage[] = [
      {
        directory: 'node-18-alpine',
        dockerfile_path: '/repo/base-images/node-18-alpine/Dockerfile',
        upstream_image: 'node:18.20.8-alpine',
        image_name: 'node',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce('base-images/node-18-alpine/\n');

    const result = detectChangedBaseImages(baseRef, baseImages, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['node-18-alpine']);
  });
});

describe('detectChangedServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should detect changed services from git diff', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
      {
        service_name: 'mqtt-influx',
        build_context: '/repo/docker/mqtt-influx',
        dockerfile_path: '/repo/docker/mqtt-influx/Dockerfile',
      },
      {
        service_name: 'modbus-serial',
        build_context: '/repo/docker/modbus-serial',
        dockerfile_path: '/repo/docker/modbus-serial/Dockerfile',
      },
    ];

    // Mock getGitRoot call
    mockExecFileSync.mockReturnValueOnce('/repo');
    // Mock git diff call
    mockExecFileSync.mockReturnValueOnce('docker/automations/index.js\ndocker/mqtt-influx/Dockerfile\n');

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['rev-parse', '--show-toplevel'],
      { encoding: 'utf-8' }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['diff', '--name-only', 'origin/master', 'HEAD', '--', 'docker/'],
      { cwd: '/repo', encoding: 'utf-8' }
    );
    expect(result).toEqual(['automations', 'mqtt-influx']);
  });

  test('should return empty array when no services changed', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce('');

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(result).toEqual([]);
  });

  test('should handle services with multiple file changes', () => {
    const baseRef = 'main';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce(
        'docker/automations/index.js\ndocker/automations/package.json\ndocker/automations/Dockerfile\n'
    );

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['automations']);
  });

  test('should deduplicate changed services', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce('docker/automations/index.js\ndocker/automations/package.json\n');

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['automations']);
  });

  test('should only return known service directories', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce('docker/automations/index.js\ndocker/unknown-service/index.js\n');

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(result).toEqual(['automations']);
  });

  test('should handle empty services list', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [];

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(result).toEqual([]);
  });

  test('should throw error when git command fails', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('fatal: bad revision \'origin/master\'');
    });

    expect(() => detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync })).toThrow(
      'fatal: bad revision \'origin/master\''
    );
  });

  test('should ignore changes in docker/ root files', () => {
    const baseRef = 'origin/master';
    const services: Service[] = [
      {
        service_name: 'automations',
        build_context: '/repo/docker/automations',
        dockerfile_path: '/repo/docker/automations/Dockerfile',
      },
    ];

    mockExecFileSync.mockReturnValueOnce('/repo');
    mockExecFileSync.mockReturnValueOnce('docker/README.md\n');

    const result = detectChangedServices(baseRef, services, { execFileSync: mockExecFileSync });

    expect(result).toEqual([]);
  });
});

describe('validateBaseImageExactCopy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should pass validation for exact copy with FROM and LABEL', () => {
    const dockerfilePath = '/repo/base-images/node-18-alpine/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
LABEL org.opencontainers.image.source="https://github.com/groupsky/homy"
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).not.toThrow();
  });

  test('should pass validation for FROM only', () => {
    const dockerfilePath = '/repo/base-images/alpine/Dockerfile';
    const dockerfileContent = `FROM alpine:3.21
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).not.toThrow();
  });

  test('should pass validation with multiple LABELs', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
LABEL org.opencontainers.image.source="https://github.com/groupsky/homy"
LABEL org.opencontainers.image.description="Node.js base image"
LABEL maintainer="admin@example.com"
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).not.toThrow();
  });

  test('should fail validation when RUN instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
RUN apk add --no-cache git
LABEL org.opencontainers.image.source="https://github.com/groupsky/homy"
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /Base image Dockerfile must be an exact copy/
    );
  });

  test('should fail validation when COPY instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
COPY package.json /app/
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /Base image Dockerfile must be an exact copy/
    );
  });

  test('should fail validation when ADD instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
ADD config.tar.gz /config/
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /Base image Dockerfile must be an exact copy/
    );
  });

  test('should fail validation when WORKDIR instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
WORKDIR /app
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /Base image Dockerfile must be an exact copy/
    );
  });

  test('should fail validation when ENV instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
ENV NODE_ENV=production
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /Base image Dockerfile must be an exact copy/
    );
  });

  test('should fail validation when EXPOSE instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
EXPOSE 3000
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
  });

  test('should fail validation when CMD instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
CMD ["node", "index.js"]
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
  });

  test('should fail validation when ENTRYPOINT instruction present', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine
ENTRYPOINT ["docker-entrypoint.sh"]
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
  });

  test('should pass validation with comments and empty lines', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `# Base image for Node.js applications
FROM node:18.20.8-alpine

# Metadata
LABEL org.opencontainers.image.source="https://github.com/groupsky/homy"

# End of file
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).not.toThrow();
  });

  test('should fail validation with multi-stage build', () => {
    const dockerfilePath = '/repo/base-images/node/Dockerfile';
    const dockerfileContent = `FROM node:18.20.8-alpine AS base
FROM base AS final
`;

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /must have exactly one FROM/
    );
  });

  test('should throw error when file does not exist', () => {
    const dockerfilePath = '/repo/base-images/nonexistent/Dockerfile';

    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      'ENOENT: no such file or directory'
    );
  });

  test('should handle empty Dockerfile', () => {
    const dockerfilePath = '/repo/base-images/empty/Dockerfile';
    const dockerfileContent = '';

    mockReadFileSync.mockReturnValue(dockerfileContent);

    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(ValidationError);
    expect(() => validateBaseImageExactCopy(dockerfilePath, { readFileSync: mockReadFileSync })).toThrow(
      /must have exactly one FROM/
    );
  });
});
