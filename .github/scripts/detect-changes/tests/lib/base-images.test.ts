/**
 * Test suite for base-images module.
 *
 * This test suite follows Test-Driven Development (TDD) principles.
 * Uses real filesystem operations with test fixtures for integration testing.
 *
 * The base-images module is responsible for:
 * 1. Discovering all base images from base-images/ directory
 * 2. Parsing base image Dockerfiles to extract upstream image information
 * 3. Normalizing GHCR tags (special handling for node-*-alpine directories)
 * 4. Building bidirectional mappings between directory names and GHCR tags
 */

import { describe, test, expect } from '@jest/globals';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  discoverBaseImages,
  parseBaseDockerfile,
  normalizeGhcrTag,
  buildDirectoryToGhcrMapping,
} from '../../src/lib/base-images.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to test fixtures
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'base-images');

describe('TestDiscoverBaseImages', () => {
  describe('test_discover_from_fixtures', () => {
    test('Should discover all valid base images from fixtures directory', () => {
      const result = discoverBaseImages(FIXTURES_DIR);

      // Should find at least the valid test fixtures
      expect(result.length).toBeGreaterThan(0);

      // Check that node-18-alpine was found
      const node18 = result.find((img) => img.directory === 'node-18-alpine');
      expect(node18).toBeDefined();
      expect(node18!.upstream_image).toBe('node:18.20.8-alpine3.21');
      expect(node18!.image_name).toBe('node');
      expect(node18!.raw_version).toBe('18.20.8-alpine3.21');
    });
  });

  describe('test_skip_directories_without_dockerfile', () => {
    test('Should skip directories that do not contain a Dockerfile', () => {
      const result = discoverBaseImages(FIXTURES_DIR);

      // empty-dir fixture has no Dockerfile and should be skipped
      const emptyDir = result.find((img) => img.directory === 'empty-dir');
      expect(emptyDir).toBeUndefined();
    });
  });

  describe('test_skip_files_in_base_directory', () => {
    test('Should skip files (not directories) in base-images directory', () => {
      const result = discoverBaseImages(FIXTURES_DIR);

      // README.md is a file and should be skipped
      const readme = result.find((img) => img.directory === 'README.md');
      expect(readme).toBeUndefined();
    });
  });

  describe('test_skip_malformed_dockerfiles', () => {
    test('Should skip directories with malformed Dockerfiles', () => {
      const result = discoverBaseImages(FIXTURES_DIR);

      // malformed fixture has no FROM line and should be skipped
      const malformed = result.find((img) => img.directory === 'malformed');
      expect(malformed).toBeUndefined();
    });
  });

  describe('test_discover_multiple_images', () => {
    test('Should discover multiple base images correctly', () => {
      const result = discoverBaseImages(FIXTURES_DIR);

      // Should have multiple images
      expect(result.length).toBeGreaterThanOrEqual(3);

      // Check specific images
      const directories = result.map((img) => img.directory);
      expect(directories).toContain('node-18-alpine');
      expect(directories).toContain('grafana');
    });
  });
});

describe('TestParseBaseDockerfile', () => {
  describe('test_parse_simple_node_base_image', () => {
    test('Should parse simple node base image Dockerfile', () => {
      const dockerfilePath = path.join(FIXTURES_DIR, 'node-18-alpine', 'Dockerfile');
      const result = parseBaseDockerfile(dockerfilePath);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('node:18.20.8-alpine3.21');
      expect(result!.image_name).toBe('node');
      expect(result!.version_tag).toBe('18.20.8-alpine3.21');
    });
  });

  describe('test_parse_grafana_base_image', () => {
    test('Should parse grafana base image with registry prefix', () => {
      const dockerfilePath = path.join(FIXTURES_DIR, 'grafana', 'Dockerfile');
      const result = parseBaseDockerfile(dockerfilePath);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('grafana/grafana:9.5.21');
      expect(result!.image_name).toBe('grafana/grafana');
      expect(result!.version_tag).toBe('9.5.21');
    });
  });

  describe('test_parse_image_without_version', () => {
    test('Should handle base images without explicit version tag', () => {
      const dockerfilePath = path.join(FIXTURES_DIR, 'alpine', 'Dockerfile');
      const result = parseBaseDockerfile(dockerfilePath);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('alpine');
      expect(result!.image_name).toBe('alpine');
      // Version tag should be undefined (no version specified)
      expect(result!.version_tag).toBeUndefined();
    });
  });

  describe('test_parse_malformed_dockerfile', () => {
    test('Should return null for Dockerfile without FROM line', () => {
      const dockerfilePath = path.join(FIXTURES_DIR, 'malformed', 'Dockerfile');
      const result = parseBaseDockerfile(dockerfilePath);

      expect(result).toBeNull();
    });
  });

  describe('test_parse_with_comments', () => {
    test('Should ignore comments in Dockerfile', () => {
      const dockerfilePath = path.join(FIXTURES_DIR, 'node-22-alpine', 'Dockerfile');
      const result = parseBaseDockerfile(dockerfilePath);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('node:22.22.0-alpine3.23');
      expect(result!.image_name).toBe('node');
      expect(result!.version_tag).toBe('22.22.0-alpine3.23');
    });
  });
});

describe('TestNormalizeGhcrTag', () => {
  describe('test_normalize_node_alpine_directory', () => {
    test('Should handle node-18-alpine directory with version normalization', () => {
      const result = normalizeGhcrTag('node-18-alpine', '18.20.8-alpine3.21');

      // Should normalize alpine3.21 -> alpine
      expect(result).toBe('node:18.20.8-alpine');
    });
  });

  describe('test_normalize_node_22_alpine', () => {
    test('Should normalize node-22-alpine directory', () => {
      const result = normalizeGhcrTag('node-22-alpine', '22.22.0-alpine3.23');

      expect(result).toBe('node:22.22.0-alpine');
    });
  });

  describe('test_normalize_node_24_alpine', () => {
    test('Should normalize node-24-alpine directory', () => {
      const result = normalizeGhcrTag('node-24-alpine', '24.13.0-alpine3.23');

      expect(result).toBe('node:24.13.0-alpine');
    });
  });

  describe('test_normalize_grafana_no_change', () => {
    test('Should use directory name for GHCR images', () => {
      // GHCR images use flattened names (grafana:*) even if upstream is grafana/grafana:*
      const result = normalizeGhcrTag('grafana', '9.5.21');

      expect(result).toBe('grafana:9.5.21');
    });
  });

  describe('test_normalize_mosquitto', () => {
    test('Should handle mosquitto directory', () => {
      const result = normalizeGhcrTag('mosquitto', '2.0.20');

      expect(result).toBe('mosquitto:2.0.20');
    });
  });

  describe('test_normalize_influxdb', () => {
    test('Should handle influxdb directory', () => {
      const result = normalizeGhcrTag('influxdb', '1.8.10');

      expect(result).toBe('influxdb:1.8.10');
    });
  });

  describe('test_normalize_alpine', () => {
    test('Should handle alpine directory with version normalization', () => {
      const result = normalizeGhcrTag('alpine', '3.22.1');

      expect(result).toBe('alpine:3.22.1');
    });
  });

  describe('test_normalize_node_ubuntu', () => {
    test('Should handle node-ubuntu directory', () => {
      const result = normalizeGhcrTag('node-ubuntu', '18.20.8-ubuntu22.04');

      // Should normalize ubuntu22.04 -> ubuntu
      expect(result).toBe('node:18.20.8-ubuntu');
    });
  });

  describe('test_normalize_empty_version', () => {
    test('Should handle directories with no version (implicit latest)', () => {
      const result = normalizeGhcrTag('alpine', '');

      expect(result).toBe('alpine:latest');
    });
  });

  describe('test_normalize_null_version', () => {
    test('Should handle null version as latest', () => {
      const result = normalizeGhcrTag('alpine', null as any);

      expect(result).toBe('alpine:latest');
    });
  });
});

describe('TestBuildDirectoryToGhcrMapping', () => {
  describe('test_build_mapping_from_fixtures', () => {
    test('Should create bidirectional mapping for fixture base images', () => {
      const result = buildDirectoryToGhcrMapping(FIXTURES_DIR);

      // Should have entries for valid fixtures
      expect(Object.keys(result.dir_to_ghcr).length).toBeGreaterThan(0);
      expect(Object.keys(result.ghcr_to_dir).length).toBeGreaterThan(0);

      // Check specific mapping
      expect(result.dir_to_ghcr['node-18-alpine']).toBe('node:18.20.8-alpine');
      expect(result.ghcr_to_dir['node:18.20.8-alpine']).toBe('node-18-alpine');
    });
  });

  describe('test_mapping_is_bidirectional', () => {
    test('Should verify that dir_to_ghcr and ghcr_to_dir are inverses', () => {
      const result = buildDirectoryToGhcrMapping(FIXTURES_DIR);

      // Verify bidirectional consistency
      for (const [dir, ghcrTag] of Object.entries(result.dir_to_ghcr)) {
        expect(result.ghcr_to_dir[ghcrTag]).toBe(dir);
      }

      for (const [ghcrTag, dir] of Object.entries(result.ghcr_to_dir)) {
        expect(result.dir_to_ghcr[dir]).toBe(ghcrTag);
      }
    });
  });

  describe('test_mapping_excludes_invalid_dirs', () => {
    test('Should not include malformed or empty directories in mapping', () => {
      const result = buildDirectoryToGhcrMapping(FIXTURES_DIR);

      // malformed and empty-dir should not be in mapping
      expect(result.dir_to_ghcr['malformed']).toBeUndefined();
      expect(result.dir_to_ghcr['empty-dir']).toBeUndefined();
      expect(result.dir_to_ghcr['README.md']).toBeUndefined();
    });
  });
});

describe('TestBaseImagesEdgeCases', () => {
  describe('test_nonexistent_directory', () => {
    test('Should handle nonexistent base-images directory gracefully', () => {
      const fakeDir = path.join(FIXTURES_DIR, '..', 'nonexistent-12345');

      expect(() => discoverBaseImages(fakeDir)).toThrow();
    });
  });

  describe('test_empty_directory_returns_empty_array', () => {
    test('Should return empty array for directory with no valid base images', () => {
      // Create a temporary empty directory for testing
      const tempDir = path.join(FIXTURES_DIR, '..', 'temp-empty');

      // Clean up if exists
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }

      fs.mkdirSync(tempDir, { recursive: true });

      try {
        const result = discoverBaseImages(tempDir);
        expect(result).toEqual([]);
      } finally {
        // Clean up
        fs.rmSync(tempDir, { recursive: true });
      }
    });
  });
});

describe('TestBaseImagesIntegration', () => {
  describe('test_discover_and_map_workflow', () => {
    test('Should integrate discovery and mapping in complete workflow', () => {
      // Test discovery
      const baseImages = discoverBaseImages(FIXTURES_DIR);
      expect(baseImages.length).toBeGreaterThan(0);

      // Test mapping
      const mapping = buildDirectoryToGhcrMapping(FIXTURES_DIR);
      expect(Object.keys(mapping.dir_to_ghcr).length).toBeGreaterThan(0);
      expect(Object.keys(mapping.ghcr_to_dir).length).toBeGreaterThan(0);

      // Verify mapping correctness for known fixtures
      expect(mapping.dir_to_ghcr['node-18-alpine']).toBe('node:18.20.8-alpine');
      expect(mapping.ghcr_to_dir['node:18.20.8-alpine']).toBe('node-18-alpine');

      // GHCR uses flattened names (grafana:*) even if upstream is grafana/grafana:*
      expect(mapping.dir_to_ghcr['grafana']).toBe('grafana:9.5.21');
      expect(mapping.ghcr_to_dir['grafana:9.5.21']).toBe('grafana');
    });
  });

  describe('test_all_discovered_images_are_mappable', () => {
    test('Should ensure all discovered images have valid GHCR tags', () => {
      const baseImages = discoverBaseImages(FIXTURES_DIR);
      const mapping = buildDirectoryToGhcrMapping(FIXTURES_DIR);

      // Every discovered image should be in the mapping
      for (const baseImage of baseImages) {
        expect(mapping.dir_to_ghcr[baseImage.directory]).toBeDefined();
        expect(mapping.dir_to_ghcr[baseImage.directory]).not.toBe('');
      }
    });
  });
});
