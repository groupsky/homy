/**
 * Test suite for validation module.
 *
 * This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
 * for the validation module BEFORE implementation. All tests will initially FAIL (red phase)
 * until the implementation is complete.
 *
 * The validation module is responsible for:
 * 1. Validating package.json files and detecting real vs placeholder tests
 * 2. Validating .nvmrc files for proper semver format
 * 3. Detecting real test runners vs placeholder test commands
 * 4. Validating Dockerfiles (reusing dockerfile-parser)
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock fs module
const mockedReadFileSync = jest.fn<typeof import('fs').readFileSync>();

jest.unstable_mockModule('fs', () => ({
  readFileSync: mockedReadFileSync,
}));

// Import after mocking
const { validatePackageJson, validateNvmrc, hasRealTests, validateDockerfile, ValidationError } =
  await import('../../src/lib/validation.js');

describe('TestValidatePackageJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_valid_package_json_with_real_tests', () => {
    test('Should return true when package.json has real test scripts with jest', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
        scripts: {
          test: 'jest',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      const result = validatePackageJson('/path/to/package.json');

      expect(result).toBe(true);
      expect(mockedReadFileSync).toHaveBeenCalledWith('/path/to/package.json', 'utf8');
    });

    test('Should return true when package.json has real test scripts with mocha', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'mocha tests/**/*.test.js',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(true);
    });

    test('Should return true when package.json has real test scripts with vitest', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'vitest run',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(true);
    });

    test('Should return true when package.json has npm test script', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'npm test',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(true);
    });

    test('Should return true when package.json has pytest script', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'pytest',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(true);
    });

    test('Should return true when package.json has tap test script', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'tap tests/*.js',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(true);
    });
  });

  describe('test_package_json_with_placeholder_tests', () => {
    test('Should return false when test script is echo placeholder', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'echo "Error: no test specified"',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(false);
    });

    test('Should return false when test script is exit 1', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'exit 1',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(false);
    });

    test('Should return false when test script is empty string', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: '',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(false);
    });

    test('Should return false when test script combines echo and exit', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          test: 'echo "No tests" && exit 1',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(false);
    });
  });

  describe('test_package_json_without_test_script', () => {
    test('Should return false when test script is missing', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        scripts: {
          start: 'node index.js',
        },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(false);
    });

    test('Should return false when scripts section is missing', () => {
      const packageJson = JSON.stringify({
        name: 'test-package',
        version: '1.0.0',
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path/to/package.json')).toBe(false);
    });
  });

  describe('test_invalid_package_json', () => {
    test('Should throw ValidationError when package.json is invalid JSON', () => {
      mockedReadFileSync.mockReturnValue('{ invalid json }');

      expect(() => validatePackageJson('/path/to/package.json')).toThrow(ValidationError);
      expect(() => validatePackageJson('/path/to/package.json')).toThrow(/Invalid JSON/);
    });

    test('Should throw ValidationError when file does not exist', () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => validatePackageJson('/path/to/nonexistent.json')).toThrow(ValidationError);
      expect(() => validatePackageJson('/path/to/nonexistent.json')).toThrow(/not found/);
    });
  });
});

describe('TestValidateNvmrc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_valid_nvmrc_with_semver', () => {
    test('Should return true for valid semver version', () => {
      mockedReadFileSync.mockReturnValue('18.20.8\n');

      const result = validateNvmrc('/path/to/.nvmrc');

      expect(result).toBe(true);
      expect(mockedReadFileSync).toHaveBeenCalledWith('/path/to/.nvmrc', 'utf8');
    });

    test('Should return true for valid semver with v prefix', () => {
      mockedReadFileSync.mockReturnValue('v18.20.8');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(true);
    });

    test('Should return true for two-part version', () => {
      mockedReadFileSync.mockReturnValue('18.20');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(true);
    });

    test('Should return true for major version only', () => {
      mockedReadFileSync.mockReturnValue('18');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(true);
    });

    test('Should return true for version with extra whitespace', () => {
      mockedReadFileSync.mockReturnValue('  18.20.8  \n');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(true);
    });
  });

  describe('test_invalid_nvmrc_with_lts', () => {
    test('Should return false for lts/* alias', () => {
      mockedReadFileSync.mockReturnValue('lts/*');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });

    test('Should return false for lts/hydrogen alias', () => {
      mockedReadFileSync.mockReturnValue('lts/hydrogen');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });

    test('Should return false for lts/iron alias', () => {
      mockedReadFileSync.mockReturnValue('lts/iron');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });
  });

  describe('test_invalid_nvmrc_format', () => {
    test('Should return false for empty file', () => {
      mockedReadFileSync.mockReturnValue('');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });

    test('Should return false for invalid version format', () => {
      mockedReadFileSync.mockReturnValue('not-a-version');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });

    test('Should return false for node alias', () => {
      mockedReadFileSync.mockReturnValue('node');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });

    test('Should return false for system alias', () => {
      mockedReadFileSync.mockReturnValue('system');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(false);
    });
  });

  describe('test_missing_nvmrc_file', () => {
    test('Should throw ValidationError when file does not exist', () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => validateNvmrc('/path/to/.nvmrc')).toThrow(ValidationError);
      expect(() => validateNvmrc('/path/to/.nvmrc')).toThrow(/not found/);
    });
  });
});

describe('TestHasRealTests', () => {
  describe('test_detect_real_test_runners', () => {
    test('Should return true for jest', () => {
      expect(hasRealTests('jest')).toBe(true);
    });

    test('Should return true for jest with options', () => {
      expect(hasRealTests('jest --coverage')).toBe(true);
    });

    test('Should return true for mocha', () => {
      expect(hasRealTests('mocha tests/**/*.js')).toBe(true);
    });

    test('Should return true for tap', () => {
      expect(hasRealTests('tap')).toBe(true);
    });

    test('Should return true for pytest', () => {
      expect(hasRealTests('pytest')).toBe(true);
    });

    test('Should return true for npm test', () => {
      expect(hasRealTests('npm test')).toBe(true);
    });

    test('Should return true for vitest', () => {
      expect(hasRealTests('vitest run')).toBe(true);
    });

    test('Should return true for ava', () => {
      expect(hasRealTests('ava')).toBe(true);
    });

    test('Should return true for tape', () => {
      expect(hasRealTests('tape tests/*.js')).toBe(true);
    });

    test('Should return true for node --test (Node.js native test runner)', () => {
      expect(hasRealTests('node --test')).toBe(true);
    });

    test('Should return true for node --experimental-vm-modules with jest', () => {
      expect(hasRealTests('node --experimental-vm-modules node_modules/jest/bin/jest.js')).toBe(
        true
      );
    });
  });

  describe('test_detect_placeholder_tests', () => {
    test('Should return false for echo placeholder', () => {
      expect(hasRealTests('echo "Error: no test specified"')).toBe(false);
    });

    test('Should return false for exit 1', () => {
      expect(hasRealTests('exit 1')).toBe(false);
    });

    test('Should return false for empty string', () => {
      expect(hasRealTests('')).toBe(false);
    });

    test('Should return false for echo and exit combination', () => {
      expect(hasRealTests('echo "No tests" && exit 1')).toBe(false);
    });

    test('Should return false for just echo with whitespace', () => {
      expect(hasRealTests('  echo "test"  ')).toBe(false);
    });

    test('Should return false for echo with pipe to exit', () => {
      expect(hasRealTests('echo "No test specified" || exit 1')).toBe(false);
    });
  });

  describe('test_edge_cases', () => {
    test('Should handle null gracefully', () => {
      expect(hasRealTests(null as unknown as string)).toBe(false);
    });

    test('Should handle undefined gracefully', () => {
      expect(hasRealTests(undefined as unknown as string)).toBe(false);
    });

    test('Should handle whitespace-only string', () => {
      expect(hasRealTests('   \n  \t  ')).toBe(false);
    });

    test('Should be case-insensitive for test runners', () => {
      expect(hasRealTests('JEST')).toBe(true);
      expect(hasRealTests('Mocha tests/')).toBe(true);
    });

    test('Should detect jest even when deeply nested in command', () => {
      expect(hasRealTests('cross-env NODE_ENV=test jest --coverage')).toBe(true);
    });

    test('Should detect pytest even with python prefix', () => {
      expect(hasRealTests('python -m pytest')).toBe(true);
    });
  });
});

describe('TestValidateDockerfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_valid_dockerfile', () => {
    test('Should return true for valid Dockerfile without ARG in FROM', () => {
      const dockerfileContent = `FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .
CMD ["node", "index.js"]
`;

      mockedReadFileSync.mockReturnValue(dockerfileContent);

      const result = validateDockerfile('/path/to/Dockerfile');

      expect(result).toBe(true);
      expect(mockedReadFileSync).toHaveBeenCalledWith('/path/to/Dockerfile', 'utf8');
    });

    test('Should return true for multi-stage Dockerfile without ARG in FROM', () => {
      const dockerfileContent = `FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

FROM base AS build
RUN npm ci

FROM base AS RELEASE
COPY --from=build /app /app
`;

      mockedReadFileSync.mockReturnValue(dockerfileContent);

      expect(validateDockerfile('/path/to/Dockerfile')).toBe(true);
    });

    test('Should return true when ARG is used outside FROM statements', () => {
      const dockerfileContent = `FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

ARG BUILD_DATE
LABEL build_date=\${BUILD_DATE}
`;

      mockedReadFileSync.mockReturnValue(dockerfileContent);

      expect(validateDockerfile('/path/to/Dockerfile')).toBe(true);
    });
  });

  describe('test_invalid_dockerfile_with_arg_in_from', () => {
    test('Should throw ValidationError when ARG variable in FROM', () => {
      const dockerfileContent = `ARG NODE_VERSION=18.20.8

FROM ghcr.io/groupsky/homy/node:\${NODE_VERSION}-alpine
`;

      mockedReadFileSync.mockReturnValue(dockerfileContent);

      expect(() => validateDockerfile('/path/to/Dockerfile')).toThrow(ValidationError);
      expect(() => validateDockerfile('/path/to/Dockerfile')).toThrow(/ARG/);
      expect(() => validateDockerfile('/path/to/Dockerfile')).toThrow(/FROM/);
    });

    test('Should throw ValidationError when dollar sign in FROM image', () => {
      const dockerfileContent = `FROM node:$VERSION
`;

      mockedReadFileSync.mockReturnValue(dockerfileContent);

      expect(() => validateDockerfile('/path/to/Dockerfile')).toThrow(ValidationError);
    });
  });

  describe('test_missing_dockerfile', () => {
    test('Should throw ValidationError when file does not exist', () => {
      mockedReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => validateDockerfile('/path/to/Dockerfile')).toThrow(ValidationError);
      expect(() => validateDockerfile('/path/to/Dockerfile')).toThrow(/not found/);
    });
  });

  describe('test_empty_dockerfile', () => {
    test('Should return true for empty Dockerfile', () => {
      mockedReadFileSync.mockReturnValue('');

      expect(validateDockerfile('/path/to/Dockerfile')).toBe(true);
    });

    test('Should return true for Dockerfile with only comments', () => {
      mockedReadFileSync.mockReturnValue('# Comment\n# Another comment\n');

      expect(validateDockerfile('/path/to/Dockerfile')).toBe(true);
    });
  });
});

describe('TestValidationEdgeCases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('test_special_characters_in_paths', () => {
    test('Should handle paths with spaces', () => {
      const packageJson = JSON.stringify({
        scripts: { test: 'jest' },
      });

      mockedReadFileSync.mockReturnValue(packageJson);

      expect(validatePackageJson('/path with spaces/package.json')).toBe(true);
    });

    test('Should handle paths with unicode characters', () => {
      mockedReadFileSync.mockReturnValue('18.20.8');

      expect(validateNvmrc('/path/to/αβγ/.nvmrc')).toBe(true);
    });
  });

  describe('test_file_encoding_handling', () => {
    test('Should handle UTF-8 BOM in package.json', () => {
      const packageJsonWithBOM = '\ufeff' + JSON.stringify({ scripts: { test: 'jest' } });

      mockedReadFileSync.mockReturnValue(packageJsonWithBOM);

      expect(validatePackageJson('/path/to/package.json')).toBe(true);
    });

    test('Should handle various line endings in .nvmrc', () => {
      mockedReadFileSync.mockReturnValue('18.20.8\r\n');

      expect(validateNvmrc('/path/to/.nvmrc')).toBe(true);
    });
  });

  describe('test_concurrent_validation', () => {
    test('Should handle multiple simultaneous validations', async () => {
      mockedReadFileSync.mockImplementation(((path: unknown) => {
        const pathStr = String(path);
        if (pathStr.includes('package.json')) {
          return JSON.stringify({ scripts: { test: 'jest' } });
        } else if (pathStr.includes('.nvmrc')) {
          return '18.20.8';
        }
        return '';
      }) as any);

      const results = await Promise.all([
        Promise.resolve(validatePackageJson('/path1/package.json')),
        Promise.resolve(validatePackageJson('/path2/package.json')),
        Promise.resolve(validateNvmrc('/path1/.nvmrc')),
        Promise.resolve(validateNvmrc('/path2/.nvmrc')),
      ]);

      expect(results).toEqual([true, true, true, true]);
    });
  });
});
