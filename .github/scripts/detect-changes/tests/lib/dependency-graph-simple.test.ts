/**
 * Simple test suite for dependency-graph module without mocking.
 *
 * Tests the core logic using direct function calls without file system mocking.
 */

import { describe, test, expect } from '@jest/globals';
import { detectAffectedServices } from '../../src/lib/dependency-graph.js';
import type { DirectoryGHCRMapping } from '../../src/lib/types.js';

describe('detectAffectedServices', () => {
  describe('Basic Detection', () => {
    test('Should detect services affected by single base image change', () => {
      const changedBaseDirs = ['node-18-alpine'];
      const reverseDeps = new Map<string, string[]>([
        ['node-18-alpine', ['automations', 'mqtt-influx']],
        ['grafana', ['grafana-service']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual(['automations', 'mqtt-influx']);
    });

    test('Should detect services affected by multiple base image changes', () => {
      const changedBaseDirs = ['node-18-alpine', 'grafana'];
      const reverseDeps = new Map<string, string[]>([
        ['node-18-alpine', ['automations', 'mqtt-influx']],
        ['grafana', ['grafana-service']],
        ['alpine', ['nginx']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual(['automations', 'grafana-service', 'mqtt-influx']);
    });

    test('Should return empty array when no services affected', () => {
      const changedBaseDirs = ['alpine'];
      const reverseDeps = new Map<string, string[]>([
        ['node-18-alpine', ['automations']],
        ['grafana', ['grafana-service']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual([]);
    });

    test('Should return empty array when changedBaseDirs is empty', () => {
      const changedBaseDirs: string[] = [];
      const reverseDeps = new Map<string, string[]>([['node-18-alpine', ['automations']]]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual([]);
    });

    test('Should return empty array when reverseDeps is empty', () => {
      const changedBaseDirs = ['node-18-alpine'];
      const reverseDeps = new Map<string, string[]>();
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual([]);
    });
  });

  describe('Deduplication and Sorting', () => {
    test('Should deduplicate services affected by multiple base images', () => {
      const changedBaseDirs = ['node-18-alpine', 'node-22-alpine'];
      const reverseDeps = new Map<string, string[]>([
        ['node-18-alpine', ['automations', 'shared-service']],
        ['node-22-alpine', ['shared-service', 'new-service']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual(['automations', 'new-service', 'shared-service']);
      expect(result.filter((s) => s === 'shared-service')).toHaveLength(1);
    });

    test('Should return sorted array for deterministic output', () => {
      const changedBaseDirs = ['base-1', 'base-2'];
      const reverseDeps = new Map<string, string[]>([
        ['base-1', ['zulu', 'alpha']],
        ['base-2', ['mike', 'bravo']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual(['alpha', 'bravo', 'mike', 'zulu']);
    });
  });

  describe('Edge Cases', () => {
    test('Should handle base directory not in reverseDeps', () => {
      const changedBaseDirs = ['unknown-base'];
      const reverseDeps = new Map<string, string[]>([['node-18-alpine', ['automations']]]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual([]);
    });

    test('Should handle empty service list in reverseDeps', () => {
      const changedBaseDirs = ['node-18-alpine'];
      const reverseDeps = new Map<string, string[]>([['node-18-alpine', []]]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual([]);
    });
  });

  describe('Real-world Scenarios', () => {
    test('Should handle node-18-alpine update affecting multiple services', () => {
      const changedBaseDirs = ['node-18-alpine'];
      const reverseDeps = new Map<string, string[]>([
        ['node-18-alpine', ['automations', 'features', 'ha-discovery', 'modbus-serial', 'mqtt-influx']],
        ['grafana', ['grafana']],
        ['influxdb', ['influxdb']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual(['automations', 'features', 'ha-discovery', 'modbus-serial', 'mqtt-influx']);
    });

    test('Should handle infrastructure update (grafana + influxdb)', () => {
      const changedBaseDirs = ['grafana', 'influxdb'];
      const reverseDeps = new Map<string, string[]>([
        ['node-18-alpine', ['automations']],
        ['grafana', ['grafana']],
        ['influxdb', ['influxdb']],
      ]);
      const baseImageMapping: DirectoryGHCRMapping = {
        dir_to_ghcr: {},
        ghcr_to_dir: {},
      };

      const result = detectAffectedServices(changedBaseDirs, reverseDeps, baseImageMapping);

      expect(result).toEqual(['grafana', 'influxdb']);
    });
  });
});
