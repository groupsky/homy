/**
 * Version string normalization.
 *
 * Normalizes various version formats for consistent comparison:
 * - Removes 'v' prefix
 * - Pads to semantic version format (X.Y.Z)
 * - Handles special cases (latest, alpine, etc.)
 * - Strips platform-specific version suffixes (alpine3.21, debian12, ubuntu22.04)
 */

/**
 * Normalize platform-specific version suffixes in Docker image version strings.
 *
 * Normalizes versioned platform suffixes to their generic forms:
 * - alpine3.21, alpine3.19, etc. → alpine
 * - debian12, debian11, etc. → debian
 * - ubuntu22.04, ubuntu20.04, etc. → ubuntu
 *
 * Preserves non-platform suffixes (slim, openssl, bullseye, etc.)
 * and is idempotent (running twice gives same result).
 *
 * @param version - Docker image version string (e.g., "18.20.8-alpine3.21")
 * @returns Normalized version string (e.g., "18.20.8-alpine")
 *
 * @example
 * ```typescript
 * normalizeVersion("18.20.8-alpine3.21")  // "18.20.8-alpine"
 * normalizeVersion("11.2-debian12")       // "11.2-debian"
 * normalizeVersion("20.04-ubuntu22.04")   // "20.04-ubuntu"
 * normalizeVersion("1.6.23-openssl")      // "1.6.23-openssl"
 * ```
 *
 * @throws {TypeError} If version is null or undefined
 * @throws {Error} If version is not a string
 */
export function normalizeVersion(version: string): string {
  // Handle null/undefined explicitly to raise TypeError
  if (version === null || version === undefined) {
    throw new TypeError('version cannot be None');
  }

  // Validate that version is a string (raises Error for non-strings)
  if (typeof version !== 'string') {
    throw new Error('version must be a string');
  }

  // Empty strings return as-is
  if (!version) {
    return version;
  }

  // Normalize alpine versions: alpine3.21 → alpine, alpine3.19 → alpine
  version = version.replace(/alpine3\.\d+/g, 'alpine');

  // Normalize debian versions: debian12 → debian, debian11 → debian
  version = version.replace(/debian\d+/g, 'debian');

  // Normalize ubuntu versions: ubuntu22.04 → ubuntu, ubuntu20.04 → ubuntu
  version = version.replace(/ubuntu\d+\.\d+/g, 'ubuntu');

  return version;
}

/**
 * Extract semantic version core from a version string.
 *
 * Extracts the version number part before any platform suffixes or tags.
 * Handles:
 * - 2-part versions (X.Y)
 * - 3-part versions (X.Y.Z)
 * - 4-part versions (X.Y.Z.W)
 * - Version prefix 'v' (stripped)
 * - Pre-release versions (e.g., 2.0.0-rc1)
 * - Build metadata (e.g., 1.0.0+build123)
 * - Platform suffixes (e.g., -alpine, -debian)
 *
 * @param version - Version string (e.g., "18.20.8-alpine", "v1.2.3")
 * @returns Core semantic version (e.g., "18.20.8", "1.2.3")
 *
 * @example
 * ```typescript
 * extractSemverCore("18.20.8-alpine")           // "18.20.8"
 * extractSemverCore("v1.2.3")                   // "1.2.3"
 * extractSemverCore("9.5.21")                   // "9.5.21"
 * extractSemverCore("2.0.0-rc1-alpine")         // "2.0.0"
 * extractSemverCore("1.0.0+build123-alpine")    // "1.0.0"
 * ```
 */
export function extractSemverCore(version: string): string {
  if (!version) {
    return version;
  }

  // Strip leading 'v' prefix if present
  if (version.startsWith('v')) {
    version = version.substring(1);
  }

  // Extract semver core using regex
  // Pattern matches: X.Y[.Z[.W]] optionally followed by pre-release/build metadata
  // Then captures everything before platform suffixes like -alpine, -debian, etc.
  const match = version.match(/^(\d+(?:\.\d+){1,3})(?:[-+][\w.]+)?/);

  if (match) {
    return match[1];
  }

  // If no match, return original (handles edge cases)
  return version;
}
