# TypeScript Migration Guide

This document tracks the migration from Python to TypeScript for the detect-changes tooling.

## Project Structure Created

### Core Files
- ✅ `package.json` - Node.js dependencies and scripts
- ✅ `tsconfig.json` - TypeScript compiler configuration
- ✅ `jest.config.js` - Jest test framework configuration
- ✅ `.nvmrc` - Node version specification (18.20.8)
- ✅ `.gitignore-ts` - TypeScript-specific ignores

### Source Structure
```
src/
├── index.ts              # Main CLI entry point (placeholder)
├── lib/
│   ├── types.ts          # Shared TypeScript interfaces
│   ├── dockerfile-parser.ts  # (migrated from Python)
│   └── version-normalizer.ts # (migrated from Python)
└── utils/
    └── errors.ts         # Custom error classes
```

### Test Structure
```
tests/
├── lib/                  # Unit tests (to be migrated)
└── fixtures/            # Test fixtures (reused from Python)
    ├── dockerfiles/     # Sample Dockerfiles ✅
    ├── docker-compose/  # Sample compose files ✅
    └── base-images/     # Sample base image configs ✅
```

## Type Definitions

### Core Types (`src/lib/types.ts`)

- `FromLine` - Parsed FROM instruction
- `HealthcheckParams` - Healthcheck parameters
- `BaseImageInfo` - Upstream image information
- `BaseImage` - Discovered base image metadata
- `Service` - Service from docker-compose.yml
- `DirectoryGHCRMapping` - Bidirectional directory/GHCR mapping
- `DetectionResult` - Change detection results
- `GitHubActionsOutputs` - GitHub Actions output format

### Error Classes (`src/utils/errors.ts`)

- `ValidationError` - Dockerfile validation errors
- `GHCRError` - GHCR-related errors
- `GHCRRateLimitError` - GHCR rate limit errors

## Dependencies

### Production
- `commander` (^12.1.0) - CLI argument parsing
- `dockerfile-ast` (^0.7.1) - Dockerfile parsing
- `js-yaml` (^4.1.0) - YAML parsing for docker-compose
- `semver` (^7.6.0) - Semantic version handling
- `tsx` (^4.20.1) - TypeScript execution

### Development
- `@jest/globals` (^29.7.0) - Jest testing globals
- `@types/js-yaml` (^4.0.9) - TypeScript types for js-yaml
- `@types/node` (^18.19.0) - Node.js type definitions
- `@types/semver` (^7.5.8) - Semver type definitions
- `jest` (^29.7.0) - Test framework
- `ts-jest` (^29.2.5) - Jest TypeScript support
- `typescript` (^5.7.3) - TypeScript compiler

## Migration Status

### ✅ Completed
1. Project structure setup
2. TypeScript configuration
3. Jest test configuration
4. Type definitions
5. Error classes
6. CLI entry point (placeholder)
7. Test fixtures copied
8. Documentation updated

### 🔄 In Progress (Other Tasks)
- Converting dockerfile-parser module (#27)
- Converting version-normalizer module (#28)

### ⏳ Pending
- Convert remaining Stage 1 modules (#29)
- Convert main entry point (#30)
- Update GitHub Actions workflow (#31)
- Full test suite migration
- Integration testing

## NPM Scripts

```bash
# Development
npm run detect-changes    # Run the CLI tool
npm run typecheck         # Type checking

# Testing
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

## TypeScript Configuration Highlights

- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Strict mode**: Enabled
- **No unused locals/parameters**: Enforced
- **No implicit returns**: Enforced
- **Coverage thresholds**: 80% (branches, functions, lines, statements)

## Migration Guidelines

When migrating Python modules to TypeScript:

1. **Read Python implementation** to understand logic
2. **Create TypeScript equivalent** with proper types
3. **Migrate or create tests** in `tests/lib/`
4. **Ensure type safety** - use strict TypeScript
5. **Add JSDoc comments** for complex functions
6. **Run type checking**: `npm run typecheck`
7. **Run tests**: `npm test`
8. **Update this document** with migration status

## Test Fixtures

Test fixtures from Python implementation are available in `tests/fixtures/`:

- **dockerfiles/** - Sample Dockerfiles for parser testing
  - base_image_exact_copy.dockerfile
  - base_image_invalid_with_run.dockerfile
  - complex_multi_stage.dockerfile
  - healthcheck_two_params.dockerfile
  - home_assistant_exception.dockerfile
  - multi_stage_with_healthcheck.dockerfile
  - non_ghcr_base.dockerfile
  - single_stage_no_healthcheck.dockerfile
  - with_arg_in_from.dockerfile

- **docker-compose/** - Sample compose files
  - sample-compose.yml

- **base-images/** - Base image configurations (empty, placeholder)

## Next Steps

1. Complete dockerfile-parser migration (#27)
2. Complete version-normalizer migration (#28)
3. Migrate remaining modules one by one
4. Write TypeScript tests for each module
5. Update GitHub Actions to use TypeScript version
6. Remove Python implementation after full migration
