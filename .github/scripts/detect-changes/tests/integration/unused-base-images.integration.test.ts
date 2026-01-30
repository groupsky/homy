/**
 * Integration test for unused base images detection.
 *
 * Verifies that the detect-changes script properly identifies and reports
 * base images that are not referenced by any service, and fails the build
 * when unused base images are found.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.join(__dirname, '../tmp-unused-base-images');
const scriptPath = path.resolve(__dirname, '../../src/index.ts');

describe('Unused Base Images Detection', () => {
  beforeAll(() => {
    // Create test directory structure
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('Should warn when base images are not used by any service', () => {
    // Setup: Create base-images with two images
    const baseImagesDir = path.join(testDir, 'base-images');
    fs.mkdirSync(path.join(baseImagesDir, 'node-18-alpine'), { recursive: true });
    fs.mkdirSync(path.join(baseImagesDir, 'unused-grafana'), { recursive: true });

    fs.writeFileSync(
      path.join(baseImagesDir, 'node-18-alpine/Dockerfile'),
      'FROM node:18.20.8-alpine3.21\n'
    );
    fs.writeFileSync(
      path.join(baseImagesDir, 'unused-grafana/Dockerfile'),
      'FROM grafana/grafana:9.5.21\n'
    );

    // Setup: Create docker-compose.yml with only one service using node
    const composeFile = path.join(testDir, 'docker-compose.yml');
    fs.writeFileSync(
      composeFile,
      `version: '3.8'
services:
  test-service:
    image: ghcr.io/groupsky/homy/test-service:latest
    build:
      context: ./docker/test-service
      dockerfile: Dockerfile
`
    );

    // Setup: Create service Dockerfile using only node base image
    const dockerDir = path.join(testDir, 'docker/test-service');
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.writeFileSync(
      path.join(dockerDir, 'Dockerfile'),
      'FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\nRUN echo "test"\n'
    );

    // Setup: Create .env file
    const envFile = path.join(testDir, '.env');
    fs.writeFileSync(envFile, 'CONFIG_PATH=./config\n');

    // Setup: Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    execSync('git add -A', { cwd: testDir });
    execSync('git commit -m "Initial commit"', { cwd: testDir });

    // Setup: Create output file path
    const outputFile = path.join(testDir, 'output.txt');

    // Execute: Run detect-changes script (should succeed but warn)
    const result = execSync(
      `npx tsx ${scriptPath} --base-ref HEAD --base-images-dir ${baseImagesDir} --compose-file ${composeFile} --env-file ${envFile} --docker-dir ${path.join(testDir, 'docker')} --output-file ${outputFile} --base-sha abc123 2>&1`,
      { cwd: testDir, encoding: 'utf-8' }
    );

    // Verify warning message in output (stderr redirected to stdout)
    expect(result).toContain('⚠️  WARNING: Unused base images detected!');
    expect(result).toContain('unused-grafana');

    // Verify output file created and contains unused_base_images
    expect(fs.existsSync(outputFile)).toBe(true);
    const output = fs.readFileSync(outputFile, 'utf-8');
    expect(output).toContain('unused_base_images=["unused-grafana"]');
  });

  test('Should pass when all base images are used', () => {
    // Setup: Create base-images with two images
    const baseImagesDir = path.join(testDir, 'base-images');
    if (fs.existsSync(baseImagesDir)) {
      fs.rmSync(baseImagesDir, { recursive: true });
    }
    fs.mkdirSync(path.join(baseImagesDir, 'node-18-alpine'), { recursive: true });
    fs.mkdirSync(path.join(baseImagesDir, 'grafana'), { recursive: true });

    fs.writeFileSync(
      path.join(baseImagesDir, 'node-18-alpine/Dockerfile'),
      'FROM node:18.20.8-alpine3.21\n'
    );
    fs.writeFileSync(
      path.join(baseImagesDir, 'grafana/Dockerfile'),
      'FROM grafana/grafana:9.5.21\n'
    );

    // Setup: Create docker-compose.yml with two services
    const composeFile = path.join(testDir, 'docker-compose.yml');
    fs.writeFileSync(
      composeFile,
      `version: '3.8'
services:
  test-node-service:
    image: ghcr.io/groupsky/homy/test-node-service:latest
    build:
      context: ./docker/test-node-service
      dockerfile: Dockerfile
  test-grafana-service:
    image: ghcr.io/groupsky/homy/test-grafana-service:latest
    build:
      context: ./docker/test-grafana-service
      dockerfile: Dockerfile
`
    );

    // Setup: Create service Dockerfiles
    const nodeServiceDir = path.join(testDir, 'docker/test-node-service');
    fs.mkdirSync(nodeServiceDir, { recursive: true });
    fs.writeFileSync(
      path.join(nodeServiceDir, 'Dockerfile'),
      'FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\nRUN echo "test"\n'
    );

    const grafanaServiceDir = path.join(testDir, 'docker/test-grafana-service');
    fs.mkdirSync(grafanaServiceDir, { recursive: true });
    fs.writeFileSync(
      path.join(grafanaServiceDir, 'Dockerfile'),
      'FROM ghcr.io/groupsky/homy/grafana:9.5.21\nRUN echo "test"\n'
    );

    // Setup: Create .env file
    const envFile = path.join(testDir, '.env');
    fs.writeFileSync(envFile, 'CONFIG_PATH=./config\n');

    // Setup: Reinitialize git repo
    if (fs.existsSync(path.join(testDir, '.git'))) {
      fs.rmSync(path.join(testDir, '.git'), { recursive: true });
    }
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    execSync('git add -A', { cwd: testDir });
    execSync('git commit -m "Initial commit"', { cwd: testDir });

    // Setup: Create output file path
    const outputFile = path.join(testDir, 'output.txt');

    // Execute: Run detect-changes script (should pass)
    try {
      execSync(
        `npx tsx ${scriptPath} --base-ref HEAD --base-images-dir ${baseImagesDir} --compose-file ${composeFile} --env-file ${envFile} --docker-dir ${path.join(testDir, 'docker')} --output-file ${outputFile} --base-sha abc123`,
        { cwd: testDir, stdio: 'pipe' }
      );

      // Verify success
      expect(fs.existsSync(outputFile)).toBe(true);

      // Verify output contains empty unused_base_images
      const output = fs.readFileSync(outputFile, 'utf-8');
      expect(output).toContain('unused_base_images=[]');
    } catch (error: any) {
      const stderr = error.stderr?.toString() || '';
      const stdout = error.stdout?.toString() || '';
      console.error('STDERR:', stderr);
      console.error('STDOUT:', stdout);
      throw error;
    }
  });

  test('Should warn about multiple unused base images', () => {
    // Setup: Create base-images with four images
    const baseImagesDir = path.join(testDir, 'base-images');
    if (fs.existsSync(baseImagesDir)) {
      fs.rmSync(baseImagesDir, { recursive: true });
    }
    fs.mkdirSync(path.join(baseImagesDir, 'node-18-alpine'), { recursive: true });
    fs.mkdirSync(path.join(baseImagesDir, 'unused-grafana'), { recursive: true });
    fs.mkdirSync(path.join(baseImagesDir, 'unused-nginx'), { recursive: true });
    fs.mkdirSync(path.join(baseImagesDir, 'unused-alpine'), { recursive: true });

    fs.writeFileSync(
      path.join(baseImagesDir, 'node-18-alpine/Dockerfile'),
      'FROM node:18.20.8-alpine3.21\n'
    );
    fs.writeFileSync(
      path.join(baseImagesDir, 'unused-grafana/Dockerfile'),
      'FROM grafana/grafana:9.5.21\n'
    );
    fs.writeFileSync(
      path.join(baseImagesDir, 'unused-nginx/Dockerfile'),
      'FROM nginx:1.25.5-alpine3.21\n'
    );
    fs.writeFileSync(
      path.join(baseImagesDir, 'unused-alpine/Dockerfile'),
      'FROM alpine:3.22.1\n'
    );

    // Setup: Create docker-compose.yml with only one service
    const composeFile = path.join(testDir, 'docker-compose.yml');
    fs.writeFileSync(
      composeFile,
      `version: '3.8'
services:
  test-service:
    image: ghcr.io/groupsky/homy/test-service:latest
    build:
      context: ./docker/test-service
      dockerfile: Dockerfile
`
    );

    // Setup: Create service Dockerfile using only node
    const dockerDir = path.join(testDir, 'docker/test-service');
    if (fs.existsSync(dockerDir)) {
      fs.rmSync(dockerDir, { recursive: true });
    }
    fs.mkdirSync(dockerDir, { recursive: true });
    fs.writeFileSync(
      path.join(dockerDir, 'Dockerfile'),
      'FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\nRUN echo "test"\n'
    );

    // Setup: Create .env file
    const envFile = path.join(testDir, '.env');
    fs.writeFileSync(envFile, 'CONFIG_PATH=./config\n');

    // Setup: Reinitialize git repo
    if (fs.existsSync(path.join(testDir, '.git'))) {
      fs.rmSync(path.join(testDir, '.git'), { recursive: true });
    }
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    execSync('git add -A', { cwd: testDir });
    execSync('git commit -m "Initial commit"', { cwd: testDir });

    // Setup: Create output file path
    const outputFile = path.join(testDir, 'output.txt');

    // Execute: Run detect-changes script (should succeed but warn)
    const result = execSync(
      `npx tsx ${scriptPath} --base-ref HEAD --base-images-dir ${baseImagesDir} --compose-file ${composeFile} --env-file ${envFile} --docker-dir ${path.join(testDir, 'docker')} --output-file ${outputFile} --base-sha abc123 2>&1`,
      { cwd: testDir, encoding: 'utf-8' }
    );

    // Verify warning message contains all three unused base images
    expect(result).toContain('⚠️  WARNING: Unused base images detected!');
    expect(result).toContain('unused-alpine');
    expect(result).toContain('unused-grafana');
    expect(result).toContain('unused-nginx');

    // Verify output file contains all unused base images
    expect(fs.existsSync(outputFile)).toBe(true);
    const output = fs.readFileSync(outputFile, 'utf-8');
    expect(output).toMatch(/unused_base_images=\["unused-alpine","unused-grafana","unused-nginx"\]/);
  });
});
