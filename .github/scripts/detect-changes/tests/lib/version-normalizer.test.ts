/**
 * Test suite for version-normalizer module.
 *
 * Following TDD principles, these tests define expected behavior
 * for version normalization functionality.
 */

import { describe, test, expect } from '@jest/globals';
import { normalizeVersion, extractSemverCore } from '../../src/lib/version-normalizer.js';

describe('TestNormalizeAlpineVersions', () => {
  test('should normalize alpine3.21 to alpine', () => {
    expect(normalizeVersion('18.20.8-alpine3.21')).toBe('18.20.8-alpine');
  });

  test('should normalize alpine3.19 to alpine', () => {
    expect(normalizeVersion('1.6.23-alpine3.19')).toBe('1.6.23-alpine');
  });

  test('should normalize alpine3.18 to alpine', () => {
    expect(normalizeVersion('16.14.2-alpine3.18')).toBe('16.14.2-alpine');
  });

  test('should normalize alpine3.20 to alpine', () => {
    expect(normalizeVersion('20.11.1-alpine3.20')).toBe('20.11.1-alpine');
  });

  test('should preserve generic alpine suffix without version', () => {
    expect(normalizeVersion('22.0.0-alpine')).toBe('22.0.0-alpine');
  });

  test('should normalize alpine edge versions', () => {
    expect(normalizeVersion('3.21.0-alpine3.21')).toBe('3.21.0-alpine');
  });

  test('should handle alpine versions with multiple digits', () => {
    expect(normalizeVersion('1.2.3-alpine3.100')).toBe('1.2.3-alpine');
  });
});

describe('TestNormalizeDebianVersions', () => {
  test('should normalize debian12 to debian', () => {
    expect(normalizeVersion('11.2-debian12')).toBe('11.2-debian');
  });

  test('should normalize debian11 to debian', () => {
    expect(normalizeVersion('10.5.1-debian11')).toBe('10.5.1-debian');
  });

  test('should normalize debian10 to debian', () => {
    expect(normalizeVersion('9.0.0-debian10')).toBe('9.0.0-debian');
  });

  test('should preserve generic debian suffix without version', () => {
    expect(normalizeVersion('8.1.0-debian')).toBe('8.1.0-debian');
  });

  test('should handle debian bookworm named releases', () => {
    // Some images use named releases instead of numbers
    expect(normalizeVersion('12.0-bookworm')).toBe('12.0-bookworm');
  });
});

describe('TestNormalizeUbuntuVersions', () => {
  test('should normalize ubuntu22.04 to ubuntu', () => {
    expect(normalizeVersion('20.04-ubuntu22.04')).toBe('20.04-ubuntu');
  });

  test('should normalize ubuntu20.04 to ubuntu', () => {
    expect(normalizeVersion('18.04-ubuntu20.04')).toBe('18.04-ubuntu');
  });

  test('should normalize ubuntu24.04 to ubuntu', () => {
    expect(normalizeVersion('22.04-ubuntu24.04')).toBe('22.04-ubuntu');
  });

  test('should preserve generic ubuntu suffix without version', () => {
    expect(normalizeVersion('20.04-ubuntu')).toBe('20.04-ubuntu');
  });

  test('should handle ubuntu LTS versions', () => {
    expect(normalizeVersion('20.04-ubuntu22.04-lts')).toBe('20.04-ubuntu-lts');
  });
});

describe('TestPreserveNonPlatformSuffixes', () => {
  test('should preserve openssl suffix', () => {
    expect(normalizeVersion('1.6.23-openssl')).toBe('1.6.23-openssl');
  });

  test('should preserve slim suffix', () => {
    expect(normalizeVersion('18.20.8-slim')).toBe('18.20.8-slim');
  });

  test('should preserve Debian codename suffixes', () => {
    expect(normalizeVersion('16.14.2-bullseye')).toBe('16.14.2-bullseye');
  });

  test('should preserve bookworm suffix', () => {
    expect(normalizeVersion('20.10.0-bookworm')).toBe('20.10.0-bookworm');
  });

  test('should preserve versions without suffixes', () => {
    expect(normalizeVersion('9.5.21')).toBe('9.5.21');
  });

  test('should preserve custom build suffixes', () => {
    expect(normalizeVersion('1.0.0-custom-build')).toBe('1.0.0-custom-build');
  });

  test('should preserve SHA-based suffixes', () => {
    expect(normalizeVersion('v1.2.3-abc123')).toBe('v1.2.3-abc123');
  });
});

describe('TestExtractSemverCore', () => {
  test('should extract core version from alpine image', () => {
    expect(extractSemverCore('18.20.8-alpine')).toBe('18.20.8');
  });

  test('should extract core version from debian image', () => {
    expect(extractSemverCore('11.2-debian')).toBe('11.2');
  });

  test('should extract core version from ubuntu image', () => {
    expect(extractSemverCore('20.04-ubuntu')).toBe('20.04');
  });

  test('should extract core version from plain semver', () => {
    expect(extractSemverCore('9.5.21')).toBe('9.5.21');
  });

  test('should extract core version from complex suffixes', () => {
    expect(extractSemverCore('1.6.23-openssl-alpine')).toBe('1.6.23');
  });

  test('should handle versions with v prefix', () => {
    expect(extractSemverCore('v1.2.3')).toBe('1.2.3');
  });

  test('should handle two-part versions', () => {
    expect(extractSemverCore('22.0')).toBe('22.0');
  });

  test('should handle four-part versions', () => {
    expect(extractSemverCore('1.2.3.4-alpine')).toBe('1.2.3.4');
  });

  test('should extract from already normalized alpine versions', () => {
    expect(extractSemverCore('18.20.8-alpine')).toBe('18.20.8');
  });

  test('should handle empty string', () => {
    expect(extractSemverCore('')).toBe('');
  });

  test('should handle non-semver strings gracefully', () => {
    const result = extractSemverCore('latest');
    expect(typeof result).toBe('string');
    expect(result).toBe('latest');
  });
});

describe('TestComplexVersionNormalization', () => {
  test('should normalize when multiple platform indicators exist', () => {
    // Some images might have complex suffix chains
    expect(normalizeVersion('1.2.3-alpine3.19-slim')).toBe('1.2.3-alpine-slim');
  });

  test('should normalize debian version but preserve codename', () => {
    expect(normalizeVersion('11.0-debian12-bookworm')).toBe('11.0-debian-bookworm');
  });

  test('should normalize alpine but preserve additional tags', () => {
    expect(normalizeVersion('16.14.2-alpine3.18-openssl')).toBe('16.14.2-alpine-openssl');
  });

  test('should handle versions with build metadata', () => {
    expect(normalizeVersion('1.0.0+build123-alpine3.19')).toBe('1.0.0+build123-alpine');
  });

  test('should handle prerelease versions', () => {
    expect(normalizeVersion('2.0.0-rc1-alpine3.20')).toBe('2.0.0-rc1-alpine');
  });

  test('should handle prerelease with build metadata', () => {
    expect(normalizeVersion('3.0.0-beta.1+exp.sha.abc-alpine3.21')).toBe('3.0.0-beta.1+exp.sha.abc-alpine');
  });
});

describe('TestEdgeCases', () => {
  test('should handle empty string', () => {
    expect(normalizeVersion('')).toBe('');
  });

  test('should handle version that is only a suffix', () => {
    expect(normalizeVersion('alpine3.19')).toBe('alpine');
  });

  test('should handle malformed versions gracefully', () => {
    // Don't crash on unexpected input
    const result = normalizeVersion('not-a-version-123-alpine3.19');
    expect(typeof result).toBe('string');
  });

  test('should handle very long version strings', () => {
    const longVersion = '1.2.3.4.5.6.7.8-alpine3.19-extra-long-suffix-chain';
    const result = normalizeVersion(longVersion);
    expect(result).not.toContain('alpine3.19');
    expect(result).toContain('alpine');
  });

  test('should handle versions with underscores', () => {
    expect(normalizeVersion('1_2_3-alpine3.19')).toBe('1_2_3-alpine');
  });

  test('should handle null input', () => {
    expect(() => normalizeVersion(null as any)).toThrow(TypeError);
  });

  test('should handle numeric input', () => {
    expect(() => normalizeVersion(123 as any)).toThrow();
  });

  test('should handle undefined input', () => {
    expect(() => normalizeVersion(undefined as any)).toThrow(TypeError);
  });

  test('should handle object input', () => {
    expect(() => normalizeVersion({} as any)).toThrow();
  });
});

describe('TestRealWorldExamples', () => {
  test('should normalize Node.js official image versions', () => {
    expect(normalizeVersion('18.20.8-alpine3.21')).toBe('18.20.8-alpine');
    expect(normalizeVersion('22.0.0-alpine3.20')).toBe('22.0.0-alpine');
  });

  test('should normalize nginx official image versions', () => {
    expect(normalizeVersion('1.27.3-alpine3.20')).toBe('1.27.3-alpine');
    expect(normalizeVersion('1.26.2-alpine3.19-slim')).toBe('1.26.2-alpine-slim');
  });

  test('should normalize PostgreSQL official image versions', () => {
    expect(normalizeVersion('16.1-alpine3.19')).toBe('16.1-alpine');
    expect(normalizeVersion('15.5-debian12')).toBe('15.5-debian');
  });

  test('should normalize Python official image versions', () => {
    expect(normalizeVersion('3.12.1-alpine3.19')).toBe('3.12.1-alpine');
    expect(normalizeVersion('3.11.7-slim-debian12')).toBe('3.11.7-slim-debian');
  });

  test('should normalize Redis official image versions', () => {
    expect(normalizeVersion('7.2.4-alpine3.19')).toBe('7.2.4-alpine');
  });

  test('should handle Grafana-specific versioning', () => {
    expect(normalizeVersion('9.5.21')).toBe('9.5.21');
    expect(normalizeVersion('10.0.0-ubuntu22.04')).toBe('10.0.0-ubuntu');
  });

  test('should handle InfluxDB versioning', () => {
    expect(normalizeVersion('2.7.4-alpine3.19')).toBe('2.7.4-alpine');
  });

  test('should handle Mosquitto MQTT broker versioning', () => {
    expect(normalizeVersion('2.0.18-openssl')).toBe('2.0.18-openssl');
  });
});

describe('TestNormalizationIdempotency', () => {
  test('normalizing twice should give same result for alpine', () => {
    const first = normalizeVersion('18.20.8-alpine3.21');
    const second = normalizeVersion(first);
    expect(first).toBe('18.20.8-alpine');
    expect(second).toBe('18.20.8-alpine');
    expect(first).toBe(second);
  });

  test('normalizing twice should give same result for debian', () => {
    const first = normalizeVersion('11.2-debian12');
    const second = normalizeVersion(first);
    expect(first).toBe('11.2-debian');
    expect(second).toBe('11.2-debian');
    expect(first).toBe(second);
  });

  test('already normalized versions should remain unchanged', () => {
    expect(normalizeVersion('1.2.3-alpine')).toBe('1.2.3-alpine');
    expect(normalizeVersion('4.5.6-debian')).toBe('4.5.6-debian');
    expect(normalizeVersion('7.8.9')).toBe('7.8.9');
  });
});
