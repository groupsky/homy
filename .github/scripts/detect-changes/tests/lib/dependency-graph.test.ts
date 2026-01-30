/**
 * Integration tests for dependency-graph module.
 *
 * Uses real test fixture files instead of mocking to test buildReverseDependencyMap.
 * The detectAffectedServices tests are in dependency-graph-simple.test.ts.
 */

import { describe, test, expect } from '@jest/globals';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildReverseDependencyMap } from '../../src/lib/dependency-graph.js';
import type { Service, DirectoryGHCRMapping } from '../../src/lib/types.js';

// Get the fixtures directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures');

describe('buildReverseDependencyMap', () => {
  describe('Integration Tests with Real Files', () => {
    test('Should map services to their base images using real Dockerfiles', () => {
      const services: Service[] = [
        {
          service_name: 'test-node-service',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
        {
          service_name: 'test-grafana-service',
          build_context: path.join(fixturesDir, 'docker/test-grafana-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-grafana-service/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {
          'node-18-alpine': 'node:18.20.8-alpine',
          grafana: 'grafana:9.5.21',
        },
        ghcr_to_dir: {
          'node:18.20.8-alpine': 'node-18-alpine',
          'grafana:9.5.21': 'grafana',
        },
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.get('node-18-alpine')).toEqual(['test-node-service']);
      expect(result.get('grafana')).toEqual(['test-grafana-service']);
      expect(result.size).toBe(2);
    });

    test('Should handle multi-stage Dockerfiles correctly', () => {
      const services: Service[] = [
        {
          service_name: 'test-node-service',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {
          'node-18-alpine': 'node:18.20.8-alpine',
        },
        ghcr_to_dir: {
          'node:18.20.8-alpine': 'node-18-alpine',
        },
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      // Should track the base image used by the final stage
      expect(result.get('node-18-alpine')).toEqual(['test-node-service']);
    });

    test('Should filter out non-GHCR base images', () => {
      const services: Service[] = [
        {
          service_name: 'test-ha-service',
          build_context: path.join(fixturesDir, 'docker/test-ha-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-ha-service/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      // Home Assistant image should be filtered out
      expect(result.size).toBe(0);
    });

    test('Should handle FROM scratch', () => {
      const services: Service[] = [
        {
          service_name: 'test-scratch-service',
          build_context: path.join(fixturesDir, 'docker/test-scratch-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-scratch-service/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.size).toBe(0);
    });

    test('Should handle multiple services depending on the same base image', () => {
      const services: Service[] = [
        {
          service_name: 'test-node-service',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
        {
          service_name: 'another-node-service',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {
          'node-18-alpine': 'node:18.20.8-alpine',
        },
        ghcr_to_dir: {
          'node:18.20.8-alpine': 'node-18-alpine',
        },
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.get('node-18-alpine')).toEqual(['another-node-service', 'test-node-service']);
    });

    test('Should handle missing Dockerfile gracefully', () => {
      const services: Service[] = [
        {
          service_name: 'non-existent',
          build_context: path.join(fixturesDir, 'docker/non-existent'),
          dockerfile_path: path.join(fixturesDir, 'docker/non-existent/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.size).toBe(0);
    });

    test('Should handle base image not in mapping', () => {
      const services: Service[] = [
        {
          service_name: 'test-node-service',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
      ];

      // Mapping doesn't include node-18-alpine
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {
          grafana: 'grafana:9.5.21',
        },
        ghcr_to_dir: {
          'grafana:9.5.21': 'grafana',
        },
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.size).toBe(0);
    });

    test('Should return sorted service arrays for deterministic output', () => {
      const services: Service[] = [
        {
          service_name: 'zebra',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
        {
          service_name: 'alpha',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
        {
          service_name: 'mike',
          build_context: path.join(fixturesDir, 'docker/test-node-service'),
          dockerfile_path: path.join(fixturesDir, 'docker/test-node-service/Dockerfile'),
        },
      ];

      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {
          'node-18-alpine': 'node:18.20.8-alpine',
        },
        ghcr_to_dir: {
          'node:18.20.8-alpine': 'node-18-alpine',
        },
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.get('node-18-alpine')).toEqual(['alpha', 'mike', 'zebra']);
    });

    test('Should handle empty services array', () => {
      const services: Service[] = [];
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = buildReverseDependencyMap(services, fixturesDir, baseImageMapping);

      expect(result.size).toBe(0);
    });
  });
});
