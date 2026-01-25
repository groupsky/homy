/**
 * Validation functions for project files.
 *
 * Provides validation capabilities for:
 * - package.json files (detecting real vs placeholder tests)
 * - .nvmrc files (validating semver format)
 * - Test scripts (detecting real test runners)
 * - Dockerfiles (validating structure and rules)
 */

import * as fs from 'fs';
import * as semver from 'semver';
import { validateNoArgInFrom } from './dockerfile-parser.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Real test runner patterns.
 * These indicate actual test frameworks/runners.
 */
const REAL_TEST_RUNNERS = [
  'jest',
  'mocha',
  'tap',
  'pytest',
  'vitest',
  'ava',
  'tape',
  'npm test',
  'node --test',
];

/**
 * Placeholder test patterns.
 * These indicate placeholder/dummy test scripts.
 */
const PLACEHOLDER_PATTERNS = ['echo', 'exit 1', 'exit 0'];

/**
 * Detect if a test script contains real test runners or placeholders.
 *
 * Checks for common test runners (jest, mocha, tap, pytest, vitest, etc.) and
 * identifies placeholder scripts (echo, exit 1, empty strings).
 *
 * @param testScript - The test script command from package.json
 * @returns True if the script appears to be a real test, False if it's a placeholder
 *
 * @example
 * ```typescript
 * hasRealTests('jest')                                    // true
 * hasRealTests('mocha tests/**\/*.test.js')              // true
 * hasRealTests('echo "Error: no test specified"')         // false
 * hasRealTests('exit 1')                                  // false
 * hasRealTests('')                                        // false
 * ```
 */
export function hasRealTests(testScript: string): boolean {
  // Handle null/undefined/empty
  if (!testScript || typeof testScript !== 'string') {
    return false;
  }

  // Trim whitespace
  const normalized = testScript.trim().toLowerCase();

  // Empty after trim
  if (!normalized) {
    return false;
  }

  // Check for placeholder patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (normalized.includes(pattern)) {
      // If it's just an echo or exit command, it's a placeholder
      // But if it also contains a test runner, it might be a real test
      const hasTestRunner = REAL_TEST_RUNNERS.some((runner) => normalized.includes(runner));
      if (!hasTestRunner) {
        return false;
      }
    }
  }

  // Check for real test runners
  for (const runner of REAL_TEST_RUNNERS) {
    if (normalized.includes(runner)) {
      return true;
    }
  }

  // Default to false if we don't recognize it
  return false;
}

/**
 * Validate a package.json file and detect real vs placeholder tests.
 *
 * Parses package.json and checks if it contains a real test script
 * (using jest, mocha, etc.) or just a placeholder (echo, exit 1).
 *
 * @param packageJsonPath - Absolute path to package.json file
 * @returns True if package.json has real tests, False if placeholder or missing
 * @throws {ValidationError} If file doesn't exist or contains invalid JSON
 *
 * @example
 * ```typescript
 * validatePackageJson('/path/to/package.json')  // true if has real tests
 * ```
 */
export function validatePackageJson(packageJsonPath: string): boolean {
  let content: string;

  try {
    content = fs.readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    throw new ValidationError(
      `package.json not found at ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let packageData: any;
  try {
    // Handle UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    packageData = JSON.parse(content);
  } catch (error) {
    throw new ValidationError(
      `Invalid JSON in ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Check if scripts section exists
  if (!packageData.scripts || typeof packageData.scripts !== 'object') {
    return false;
  }

  // Check if test script exists
  if (!packageData.scripts.test) {
    return false;
  }

  // Check if test script is real
  return hasRealTests(packageData.scripts.test);
}

/**
 * Validate an .nvmrc file for proper semver format.
 *
 * Checks that .nvmrc contains a valid semantic version (with optional 'v' prefix)
 * and rejects LTS aliases like 'lts/*' or 'lts/hydrogen'.
 *
 * @param nvmrcPath - Absolute path to .nvmrc file
 * @returns True if .nvmrc contains valid semver, False if LTS alias or invalid format
 * @throws {ValidationError} If file doesn't exist
 *
 * @example
 * ```typescript
 * validateNvmrc('/path/to/.nvmrc')  // true for "18.20.8"
 * validateNvmrc('/path/to/.nvmrc')  // false for "lts/*"
 * ```
 */
export function validateNvmrc(nvmrcPath: string): boolean {
  let content: string;

  try {
    content = fs.readFileSync(nvmrcPath, 'utf8');
  } catch (error) {
    throw new ValidationError(
      `.nvmrc not found at ${nvmrcPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Trim whitespace and normalize line endings
  const version = content.trim();

  // Reject empty content
  if (!version) {
    return false;
  }

  // Reject LTS aliases
  if (version.startsWith('lts/') || version === 'lts/*') {
    return false;
  }

  // Reject named aliases
  const namedAliases = ['node', 'system', 'iojs', 'unstable'];
  if (namedAliases.includes(version.toLowerCase())) {
    return false;
  }

  // Strip 'v' prefix if present
  let versionToCheck = version;
  if (versionToCheck.startsWith('v')) {
    versionToCheck = versionToCheck.slice(1);
  }

  // Check if it's a valid semver or semver range
  // Accept full versions (18.20.8), partial versions (18.20, 18), and ranges
  if (semver.valid(versionToCheck)) {
    return true;
  }

  // Check if it's a valid partial version (coerce will handle "18" or "18.20")
  const coerced = semver.coerce(versionToCheck);
  if (coerced) {
    return true;
  }

  // Invalid format
  return false;
}

/**
 * Validate a Dockerfile for proper structure and rules.
 *
 * Reuses dockerfile-parser validation to check:
 * - No ARG variables in FROM statements
 * - No variable substitution in base images
 *
 * @param dockerfilePath - Absolute path to Dockerfile
 * @returns True if Dockerfile is valid, False otherwise
 * @throws {ValidationError} If file doesn't exist or contains invalid patterns
 *
 * @example
 * ```typescript
 * validateDockerfile('/path/to/Dockerfile')  // true if valid
 * // Throws ValidationError if ARG in FROM
 * ```
 */
export function validateDockerfile(dockerfilePath: string): boolean {
  let content: string;

  try {
    content = fs.readFileSync(dockerfilePath, 'utf8');
  } catch (error) {
    throw new ValidationError(
      `Dockerfile not found at ${dockerfilePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Use dockerfile-parser to validate
  try {
    validateNoArgInFrom(content);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      `Invalid Dockerfile at ${dockerfilePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Re-export ValidationError for convenience
export { ValidationError };
