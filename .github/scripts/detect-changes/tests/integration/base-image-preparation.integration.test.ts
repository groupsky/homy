/**
 * Integration tests for Step 10.75: Base Image Preparation for toBuild Services
 *
 * Tests the logic that ensures all services in toBuild have their base images
 * prepared as artifacts, even if the base images already exist in GHCR.
 *
 * TDD Approach: These tests define expected behavior before implementation
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Base Image Preparation for toBuild Services', () => {
  let testDir: string;
  let baseImagesDir: string;
  let dockerDir: string;
  const projectRoot = resolve(__dirname, '../..');

  beforeEach(() => {
    // Create temporary directory for test
    testDir = mkdtempSync(join(tmpdir(), 'base-image-prep-test-'));
    baseImagesDir = join(testDir, 'base-images');
    dockerDir = join(testDir, 'docker');

    // Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
  });

  afterEach(() => {
    // Cleanup
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('when service needs build and base exists in GHCR', () => {
    it('should add base image to baseImagesNeeded (for PULL, not BUILD)', async () => {
      // ARRANGE: Setup base image directory
      const nodeBaseDir = join(baseImagesDir, 'node');
      mkdirSync(nodeBaseDir, { recursive: true });
      writeFileSync(
        join(nodeBaseDir, 'Dockerfile'),
        'FROM node:22.22.0-alpine3.23\nCMD ["node"]\n'
      );

      // ARRANGE: Setup service that uses the base
      const serviceDir = join(dockerDir, 'test-service');
      mkdirSync(serviceDir, { recursive: true });
      writeFileSync(
        join(serviceDir, 'Dockerfile'),
        'FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23\nCOPY . /app\n'
      );
      writeFileSync(join(serviceDir, '.nvmrc'), '22.22.0');

      // ARRANGE: Create docker-compose.yml
      writeFileSync(
        join(testDir, 'docker-compose.yml'),
        `
services:
  test-service:
    build:
      context: ./docker/test-service
    image: ghcr.io/groupsky/homy/test-service
`
      );

      // ARRANGE: Create example.env
      writeFileSync(join(testDir, 'example.env'), '');

      // ARRANGE: Commit initial state
      execSync('git add -A', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // ACT: Modify service Dockerfile (trigger rebuild, but base unchanged)
      writeFileSync(
        join(serviceDir, 'Dockerfile'),
        'FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23\nCOPY . /app\nRUN echo "changed"\n'
      );
      execSync('git add -A', { cwd: testDir });
      execSync('git commit -m "Change service"', { cwd: testDir });

      // ACT: Run detection using tsx
      const baseRef = 'HEAD^1';
      const baseSha = execSync('git rev-parse HEAD^1', { cwd: testDir }).toString().trim();
      const outputFile = join(testDir, 'output.txt');

      // Run detection script from test directory so git commands work on test repo
      const scriptPath = join(projectRoot, 'src/index.ts');
      execSync(
        `npx tsx "${scriptPath}" \
          --base-ref "${baseRef}" \
          --base-images-dir "${baseImagesDir}" \
          --compose-file "${join(testDir, 'docker-compose.yml')}" \
          --env-file "${join(testDir, 'example.env')}" \
          --docker-dir "${dockerDir}" \
          --base-sha "${baseSha}" \
          --output-file "${outputFile}"`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      // ASSERT: Parse outputs
      const result = execSync(`cat "${outputFile}"`, { encoding: 'utf-8' });
      const outputs = parseGithubOutputs(result);

      // Service should be in toBuild (Dockerfile changed)
      expect(JSON.parse(outputs.to_build || '[]')).toContain('test-service');

      // Base image should NOT be in changedBaseImages (base Dockerfile unchanged)
      expect(JSON.parse(outputs.changed_base_images || '[]')).not.toContain('node');

      // Base image SHOULD be in baseImagesNeeded (needed by toBuild service)
      // This ensures Stage 2 will PULL it from GHCR as artifact
      expect(JSON.parse(outputs.base_images_needed || '[]')).toContain('node');
    });

    it('should not duplicate base if already in changedBaseImages', async () => {
      // ARRANGE: Setup base image directory
      const nodeBaseDir = join(baseImagesDir, 'node');
      mkdirSync(nodeBaseDir, { recursive: true });
      writeFileSync(
        join(nodeBaseDir, 'Dockerfile'),
        'FROM node:22.22.0-alpine3.23\nCMD ["node"]\n'
      );

      // ARRANGE: Setup service
      const serviceDir = join(dockerDir, 'test-service');
      mkdirSync(serviceDir, { recursive: true });
      writeFileSync(
        join(serviceDir, 'Dockerfile'),
        'FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23\nCOPY . /app\n'
      );

      // ARRANGE: Create docker-compose.yml
      writeFileSync(
        join(testDir, 'docker-compose.yml'),
        `
services:
  test-service:
    build:
      context: ./docker/test-service
    image: ghcr.io/groupsky/homy/test-service
`
      );

      writeFileSync(join(testDir, 'example.env'), '');

      // ARRANGE: Commit initial state
      execSync('git add -A', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // ACT: Modify BOTH base and service (both should rebuild)
      writeFileSync(
        join(nodeBaseDir, 'Dockerfile'),
        'FROM node:24.13.0-alpine3.23\nCMD ["node"]\n'
      );
      writeFileSync(
        join(serviceDir, 'Dockerfile'),
        'FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.23\nCOPY . /app\n'
      );
      execSync('git add -A', { cwd: testDir });
      execSync('git commit -m "Upgrade to node 24"', { cwd: testDir });

      // ACT: Run detection using tsx
      const baseRef = 'HEAD^1';
      const baseSha = execSync('git rev-parse HEAD^1', { cwd: testDir }).toString().trim();
      const outputFile = join(testDir, 'output.txt');

      // Run detection script from test directory so git commands work on test repo
      const scriptPath = join(projectRoot, 'src/index.ts');
      execSync(
        `npx tsx "${scriptPath}" \
          --base-ref "${baseRef}" \
          --base-images-dir "${baseImagesDir}" \
          --compose-file "${join(testDir, 'docker-compose.yml')}" \
          --env-file "${join(testDir, 'example.env')}" \
          --docker-dir "${dockerDir}" \
          --base-sha "${baseSha}" \
          --output-file "${outputFile}"`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      // ASSERT: Parse outputs
      const result = execSync(`cat "${outputFile}"`, { encoding: 'utf-8' });
      const outputs = parseGithubOutputs(result);

      // Base should be in changedBaseImages (will be BUILT)
      const changedBases = JSON.parse(outputs.changed_base_images || '[]');
      expect(changedBases).toContain('node');

      // Base should NOT be duplicated in baseImagesNeeded
      const neededBases = JSON.parse(outputs.base_images_needed || '[]');
      expect(neededBases).not.toContain('node');

      // Total occurrences should be 1 (only in changedBaseImages)
      const totalOccurrences = [...changedBases, ...neededBases].filter((b) => b === 'node')
        .length;
      expect(totalOccurrences).toBe(1);
    });

    it('should handle multiple services needing same base', async () => {
      // ARRANGE: Setup base image
      const nodeBaseDir = join(baseImagesDir, 'node');
      mkdirSync(nodeBaseDir, { recursive: true });
      writeFileSync(
        join(nodeBaseDir, 'Dockerfile'),
        'FROM node:22.22.0-alpine3.23\nCMD ["node"]\n'
      );

      // ARRANGE: Setup two services using same base
      for (const serviceName of ['service-a', 'service-b']) {
        const serviceDir = join(dockerDir, serviceName);
        mkdirSync(serviceDir, { recursive: true });
        writeFileSync(
          join(serviceDir, 'Dockerfile'),
          'FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23\nCOPY . /app\n'
        );
      }

      // ARRANGE: Create docker-compose.yml
      writeFileSync(
        join(testDir, 'docker-compose.yml'),
        `
services:
  service-a:
    build:
      context: ./docker/service-a
    image: ghcr.io/groupsky/homy/service-a
  service-b:
    build:
      context: ./docker/service-b
    image: ghcr.io/groupsky/homy/service-b
`
      );

      writeFileSync(join(testDir, 'example.env'), '');

      // ARRANGE: Commit initial state
      execSync('git add -A', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // ACT: Modify both services
      for (const serviceName of ['service-a', 'service-b']) {
        const serviceDir = join(dockerDir, serviceName);
        writeFileSync(
          join(serviceDir, 'Dockerfile'),
          'FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23\nCOPY . /app\nRUN echo "changed"\n'
        );
      }
      execSync('git add -A', { cwd: testDir });
      execSync('git commit -m "Change both services"', { cwd: testDir });

      // ACT: Run detection using tsx
      const baseRef = 'HEAD^1';
      const baseSha = execSync('git rev-parse HEAD^1', { cwd: testDir }).toString().trim();
      const outputFile = join(testDir, 'output.txt');

      // Run detection script from test directory so git commands work on test repo
      const scriptPath = join(projectRoot, 'src/index.ts');
      execSync(
        `npx tsx "${scriptPath}" \
          --base-ref "${baseRef}" \
          --base-images-dir "${baseImagesDir}" \
          --compose-file "${join(testDir, 'docker-compose.yml')}" \
          --env-file "${join(testDir, 'example.env')}" \
          --docker-dir "${dockerDir}" \
          --base-sha "${baseSha}" \
          --output-file "${outputFile}"`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      // ASSERT: Parse outputs
      const result = execSync(`cat "${outputFile}"`, { encoding: 'utf-8' });
      const outputs = parseGithubOutputs(result);

      // Both services should be in toBuild
      const toBuild = JSON.parse(outputs.to_build || '[]');
      expect(toBuild).toContain('service-a');
      expect(toBuild).toContain('service-b');

      // Base should be in baseImagesNeeded exactly once (no duplication)
      const neededBases = JSON.parse(outputs.base_images_needed || '[]');
      const nodeCount = neededBases.filter((b: string) => b === 'node').length;
      expect(nodeCount).toBe(1);
    });
  });
});

/**
 * Parse GitHub Actions output format (key=value pairs)
 */
function parseGithubOutputs(output: string): Record<string, string> {
  const lines = output.split('\n');
  const result: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^([a-z_]+)=(.*)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }

  return result;
}
