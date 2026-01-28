/**
 * Integration tests for version consistency check between .nvmrc and Dockerfile.
 *
 * These tests verify that the CI pipeline correctly detects version mismatches
 * between .nvmrc files and Dockerfile FROM statements.
 *
 * Test Philosophy (TDD):
 * 1. RED: Write failing tests that expose the bug
 * 2. GREEN: Implement minimal fix to make tests pass
 * 3. REFACTOR: Clean up and optimize while keeping tests green
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Helper to create temporary test directory structure
 */
function createTestEnv() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'version-check-test-'));

  return {
    root: tmpDir,
    createService: (name: string, nvmrcVersion: string, dockerfileVersion: string) => {
      const serviceDir = join(tmpDir, 'docker', name);
      mkdirSync(serviceDir, { recursive: true });

      // Create .nvmrc
      writeFileSync(join(serviceDir, '.nvmrc'), `${nvmrcVersion}\n`);

      // Create Dockerfile with node base image
      const dockerfile = `FROM ghcr.io/groupsky/homy/node:${dockerfileVersion}-alpine3.23 AS base

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS build
RUN npm ci

FROM base AS RELEASE
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .

USER node-app
ENTRYPOINT ["node", "index.js"]
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      return serviceDir;
    },
    createServiceWithVariantBase: (
      name: string,
      nvmrcVersion: string,
      dockerfileVersion: string,
      variant: string
    ) => {
      const serviceDir = join(tmpDir, 'docker', name);
      mkdirSync(serviceDir, { recursive: true });

      // Create .nvmrc
      writeFileSync(join(serviceDir, '.nvmrc'), `${nvmrcVersion}\n`);

      // Create Dockerfile with variant node base image (e.g., node-ubuntu)
      const dockerfile = `FROM ghcr.io/groupsky/homy/node-${variant}:${dockerfileVersion} AS base

RUN apt-get update && apt-get install -y libftdi1 && \\
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS build
RUN npm ci

FROM base AS RELEASE
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .

USER node-app
ENTRYPOINT ["node", "index.js"]
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      return serviceDir;
    },
    cleanup: () => {
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Simulates the version consistency check script from ci-unified.yml
 */
function checkVersionConsistency(serviceDir: string): { match: boolean; nvmrc: string; dockerfile: string } {
  const nvmrcPath = join(serviceDir, '.nvmrc');
  const dockerfilePath = join(serviceDir, 'Dockerfile');

  // Read .nvmrc (trim whitespace)
  const nvmrcContent = readFileSync(nvmrcPath, 'utf8');
  const nvmrcVersion = nvmrcContent.trim();

  // Extract version from Dockerfile using same logic as ci-unified.yml line 752
  // UPDATED: Support both node: and node-<variant>: patterns (e.g., node-ubuntu:)
  const dockerfileContent = readFileSync(dockerfilePath, 'utf8');
  const fromLines = dockerfileContent.split('\n').filter((line) => /^FROM.*node(-[a-z]+)?:/.test(line));

  if (fromLines.length === 0) {
    throw new Error('No node base image found in Dockerfile');
  }

  // Get last FROM line with node: or node-<variant>: (final stage)
  const finalFromLine = fromLines[fromLines.length - 1];

  // Extract version using sed-like regex - supports both node: and node-<variant>: patterns
  const match = finalFromLine.match(/node(-[a-z]+)?:([0-9.]+)/);
  if (!match) {
    throw new Error('Could not extract Node.js version from Dockerfile');
  }
  const dockerfileVersion = match[2]; // Version is in capture group 2

  return {
    match: nvmrcVersion === dockerfileVersion,
    nvmrc: nvmrcVersion,
    dockerfile: dockerfileVersion,
  };
}

describe('VersionConsistencyIntegration', () => {
  let testEnv: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    testEnv = createTestEnv();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('test_matching_versions', () => {
    test('Should pass when .nvmrc and Dockerfile versions match exactly', () => {
      const serviceDir = testEnv.createService('automations', '24.13.0', '24.13.0');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
      expect(result.nvmrc).toBe('24.13.0');
      expect(result.dockerfile).toBe('24.13.0');
    });

    test('Should pass for older Node 18.x versions', () => {
      const serviceDir = testEnv.createService('mqtt-influx', '18.20.8', '18.20.8');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
      expect(result.nvmrc).toBe('18.20.8');
      expect(result.dockerfile).toBe('18.20.8');
    });

    test('Should pass for Node 22.x versions', () => {
      const serviceDir = testEnv.createService('telegram-bridge', '22.12.0', '22.12.0');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
    });
  });

  describe('test_mismatched_versions', () => {
    test('Should fail when .nvmrc is behind Dockerfile - THE BUG WE ARE FIXING', () => {
      // This is the actual bug from PR #1203
      // docker/modbus-serial/.nvmrc = 24.12.0
      // docker/modbus-serial/Dockerfile = 24.13.0
      const serviceDir = testEnv.createService('modbus-serial', '24.12.0', '24.13.0');

      const result = checkVersionConsistency(serviceDir);

      // TEST SHOULD FAIL (RED phase of TDD)
      expect(result.match).toBe(false);
      expect(result.nvmrc).toBe('24.12.0');
      expect(result.dockerfile).toBe('24.13.0');
    });

    test('Should fail when .nvmrc is ahead of Dockerfile', () => {
      const serviceDir = testEnv.createService('automations', '24.15.0', '24.13.0');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(false);
      expect(result.nvmrc).toBe('24.15.0');
      expect(result.dockerfile).toBe('24.13.0');
    });

    test('Should fail when patch versions differ', () => {
      const serviceDir = testEnv.createService('features', '18.20.8', '18.20.7');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(false);
    });

    test('Should fail when minor versions differ', () => {
      const serviceDir = testEnv.createService('ha-discovery', '18.19.0', '18.20.0');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(false);
    });

    test('Should fail when major versions differ', () => {
      const serviceDir = testEnv.createService('sunseeker', '18.20.8', '22.12.0');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(false);
    });
  });

  describe('test_version_format_edge_cases', () => {
    test('Should handle .nvmrc with trailing newline', () => {
      const serviceDir = testEnv.createService('test-service', '24.13.0', '24.13.0');

      // .nvmrc already has trailing newline from createService
      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
    });

    test('Should handle .nvmrc with extra whitespace', () => {
      const serviceDir = join(testEnv.root, 'docker', 'whitespace-service');
      mkdirSync(serviceDir, { recursive: true });

      // Create .nvmrc with extra whitespace
      writeFileSync(join(serviceDir, '.nvmrc'), '  24.13.0  \n');

      // Create Dockerfile
      const dockerfile = `FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.23 AS base
WORKDIR /app
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
    });

    test('Should handle Dockerfile with different alpine versions', () => {
      const serviceDir = join(testEnv.root, 'docker', 'alpine-service');
      mkdirSync(serviceDir, { recursive: true });

      writeFileSync(join(serviceDir, '.nvmrc'), '24.13.0\n');

      // Different alpine suffix should not affect version match
      const dockerfile = `FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.22 AS base
WORKDIR /app
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
    });
  });

  describe('test_ghcr_base_image_variants', () => {
    test('Should handle node-ubuntu variant with matching versions', () => {
      // This is the real-world case from docker/dmx-driver
      const serviceDir = testEnv.createServiceWithVariantBase('dmx-driver', '18.12.1', '18.12.1', 'ubuntu');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
      expect(result.nvmrc).toBe('18.12.1');
      expect(result.dockerfile).toBe('18.12.1');
    });

    test('Should detect version mismatch with node-ubuntu variant', () => {
      // Simulate Dependabot update from 18.12.1 to 18.20.8
      const serviceDir = testEnv.createServiceWithVariantBase('dmx-driver', '18.12.1', '18.20.8', 'ubuntu');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(false);
      expect(result.nvmrc).toBe('18.12.1');
      expect(result.dockerfile).toBe('18.20.8');
    });

    test('Should handle node-alpine variant if created in future', () => {
      const serviceDir = testEnv.createServiceWithVariantBase('test-service', '18.20.8', '18.20.8', 'alpine');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
      expect(result.nvmrc).toBe('18.20.8');
      expect(result.dockerfile).toBe('18.20.8');
    });

    test('Should handle node-slim variant if created in future', () => {
      const serviceDir = testEnv.createServiceWithVariantBase('test-service', '22.12.0', '22.12.0', 'slim');

      const result = checkVersionConsistency(serviceDir);

      expect(result.match).toBe(true);
      expect(result.nvmrc).toBe('22.12.0');
      expect(result.dockerfile).toBe('22.12.0');
    });

    test('Should work with standard node: base and variant node-ubuntu: in same codebase', () => {
      // Create one service with standard node:
      const standardService = testEnv.createService('standard-service', '24.13.0', '24.13.0');
      const standardResult = checkVersionConsistency(standardService);

      // Create another service with variant node-ubuntu:
      const variantService = testEnv.createServiceWithVariantBase('variant-service', '18.12.1', '18.12.1', 'ubuntu');
      const variantResult = checkVersionConsistency(variantService);

      // Both should pass
      expect(standardResult.match).toBe(true);
      expect(variantResult.match).toBe(true);
    });
  });

  describe('test_multi_stage_dockerfile', () => {
    test('Should extract version from final stage, not first stage', () => {
      const serviceDir = join(testEnv.root, 'docker', 'multi-stage');
      mkdirSync(serviceDir, { recursive: true });

      writeFileSync(join(serviceDir, '.nvmrc'), '24.13.0\n');

      // Dockerfile with multiple FROM statements
      const dockerfile = `FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS old-base

FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.23 AS base
WORKDIR /app

FROM base AS build
RUN npm ci

FROM base AS RELEASE
COPY . .
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      const result = checkVersionConsistency(serviceDir);

      // Should use 24.13.0 from the FINAL stage, not 18.20.8
      expect(result.match).toBe(true);
      expect(result.dockerfile).toBe('24.13.0');
    });
  });

  describe('test_error_handling', () => {
    test('Should throw error when .nvmrc is missing', () => {
      const serviceDir = join(testEnv.root, 'docker', 'no-nvmrc');
      mkdirSync(serviceDir, { recursive: true });

      const dockerfile = `FROM ghcr.io/groupsky/homy/node:24.13.0-alpine AS base
WORKDIR /app
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      expect(() => checkVersionConsistency(serviceDir)).toThrow();
    });

    test('Should throw error when Dockerfile is missing', () => {
      const serviceDir = join(testEnv.root, 'docker', 'no-dockerfile');
      mkdirSync(serviceDir, { recursive: true });

      writeFileSync(join(serviceDir, '.nvmrc'), '24.13.0\n');

      expect(() => checkVersionConsistency(serviceDir)).toThrow();
    });

    test('Should throw error when Dockerfile has no node base image', () => {
      const serviceDir = join(testEnv.root, 'docker', 'no-node-base');
      mkdirSync(serviceDir, { recursive: true });

      writeFileSync(join(serviceDir, '.nvmrc'), '24.13.0\n');

      const dockerfile = `FROM ghcr.io/groupsky/homy/alpine:3.23
WORKDIR /app
`;
      writeFileSync(join(serviceDir, 'Dockerfile'), dockerfile);

      expect(() => checkVersionConsistency(serviceDir)).toThrow('No node base image found');
    });
  });

  describe('test_real_world_scenario_pr1203', () => {
    test('Should detect the exact bug from PR #1203', () => {
      // Reproduce the exact issue from the bug report
      const modbusSerialDir = testEnv.createService('modbus-serial', '24.12.0', '24.13.0');

      const result = checkVersionConsistency(modbusSerialDir);

      // This test documents the bug: check should FAIL but was NOT RUNNING
      expect(result.match).toBe(false);
      expect(result.nvmrc).toBe('24.12.0');
      expect(result.dockerfile).toBe('24.13.0');

      // Verify the error message would be helpful
      if (!result.match) {
        const errorMessage = `Version mismatch detected!
  .nvmrc:     ${result.nvmrc}
  Dockerfile: ${result.dockerfile}

To fix this issue:
  1. Update .nvmrc to match Dockerfile version, OR
  2. Update Dockerfile FROM line to match .nvmrc version`;

        expect(errorMessage).toContain('24.12.0');
        expect(errorMessage).toContain('24.13.0');
      }
    });

    test('Should pass after fixing the version mismatch', () => {
      // After fix: both should be 24.13.0
      const modbusSerialDir = testEnv.createService('modbus-serial', '24.13.0', '24.13.0');

      const result = checkVersionConsistency(modbusSerialDir);

      expect(result.match).toBe(true);
    });
  });

  describe('test_ci_workflow_integration', () => {
    test('Should verify workflow script logic matches expectations', () => {
      // Test that our checkVersionConsistency function matches ci-unified.yml logic
      const serviceDir = testEnv.createService('test', '24.13.0', '24.13.0');

      // Read files using same commands as workflow
      const nvmrcCmd = `cat "${join(serviceDir, '.nvmrc')}" | tr -d '[:space:]'`;
      const nvmrcVersion = execSync(nvmrcCmd, { encoding: 'utf8' });

      const dockerfileCmd = `grep -E "^FROM.*node:" "${join(serviceDir, 'Dockerfile')}" | tail -1 | sed 's/.*node:\\([0-9.]*\\).*/\\1/'`;
      const dockerfileVersion = execSync(dockerfileCmd, { encoding: 'utf8' }).trim();

      expect(nvmrcVersion).toBe('24.13.0');
      expect(dockerfileVersion).toBe('24.13.0');
    });
  });
});
