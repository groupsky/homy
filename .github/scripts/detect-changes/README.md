# Docker Build Change Detection

This directory contains TypeScript tooling for detecting which Docker images need to be rebuilt based on file changes in the repository.

## Purpose

The change detection system:
- Analyzes changed files to determine which base images and services are affected
- Builds a dependency graph of Docker images (base images -> services)
- Determines the optimal build order considering dependencies
- Integrates with GHCR to check if images already exist
- Outputs build matrix for GitHub Actions workflows

## Architecture

### Core Components

- **`src/index.ts`**: Main CLI entry point
- **`src/lib/base-images.ts`**: Base image discovery and parsing
- **`src/lib/services.ts`**: Service discovery from docker-compose.yml
- **`src/lib/dockerfile-parser.ts`**: Dockerfile parsing and dependency extraction
- **`src/lib/dependency-graph.ts`**: Build dependency graph construction
- **`src/lib/change-detection.ts`**: File change to image mapping logic
- **`src/lib/ghcr-client.ts`**: GHCR API client for image existence checks
- **`src/lib/version-normalizer.ts`**: Version string normalization
- **`src/lib/validation.ts`**: Configuration validation utilities
- **`src/lib/types.ts`**: Shared TypeScript interfaces
- **`src/utils/errors.ts`**: Custom error classes

### Test Structure

- **`tests/lib/*.test.ts`**: Unit tests for each module
- **`tests/integration/*.test.ts`**: Integration tests for end-to-end workflows
- **`tests/fixtures/`**: Sample Dockerfiles, compose files, and base-images configs

## Installation

```bash
# Install dependencies
npm install

# Type checking
npm run typecheck
```

## Usage

```bash
# Detect changes
npm run detect-changes -- detect --base-ref origin/master --sha abc123

# Or with tsx directly
npx tsx src/index.ts detect --base-ref origin/master --sha abc123
```

## Testing

```bash
# Run all tests
npm test

# Watch mode (re-run on changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

## Development Workflow

This project follows **Test-Driven Development (TDD)**:

1. **Red**: Write a failing test for new functionality
2. **Green**: Implement minimal code to pass the test
3. **Refactor**: Clean up code while keeping tests green

### Adding New Features

1. Create test file in `tests/lib/*.test.ts`
2. Write test cases defining expected behavior
3. Run tests to confirm they fail (Red)
4. Implement feature in `src/lib/*.ts`
5. Run tests to confirm they pass (Green)
6. Refactor and optimize (keeping tests green)

## Integration with GitHub Actions

The detection script outputs a JSON matrix compatible with GitHub Actions:

```json
{
  "include": [
    {
      "image": "base-images/node",
      "dockerfile": "base-images/node/Dockerfile",
      "context": "base-images/node",
      "tags": ["ghcr.io/groupsky/homy/node:18.20.8-alpine"],
      "build_reason": "file_change"
    }
  ]
}
```

This matrix is consumed by the build workflow to parallelize image builds.

## Key Design Decisions

### Two-Stage Build Detection

1. **Stage 1 (this directory)**: Fast change detection using file paths and Dockerfile parsing
   - No Docker builds required
   - Quick feedback in CI (<30 seconds)
   - Determines what needs to be built

2. **Stage 2**: Actual Docker builds with layer caching
   - Leverages GHCR for caching
   - Skips unchanged images via GHCR existence checks

### Dependency Resolution

- Base images must be built before dependent services
- Circular dependencies are detected and rejected
- Build order respects the dependency graph

### Version Normalization

- Handles various version formats (1.0, 1.0.0, v1.0, etc.)
- Normalizes for consistent comparison
- Used for image tag generation

## File Structure

```
.github/scripts/detect-changes/
├── src/
│   ├── lib/              # Core libraries
│   │   ├── types.ts      # Shared TypeScript interfaces
│   │   ├── base-images.ts
│   │   ├── services.ts
│   │   ├── dockerfile-parser.ts
│   │   ├── dependency-graph.ts
│   │   ├── change-detection.ts
│   │   ├── ghcr-client.ts
│   │   ├── version-normalizer.ts
│   │   └── validation.ts
│   ├── utils/
│   │   └── errors.ts     # Custom error classes
│   └── index.ts          # Main CLI entry point
├── tests/
│   ├── lib/              # Unit tests
│   ├── integration/      # Integration tests
│   └── fixtures/         # Test fixtures
│       ├── dockerfiles/  # Sample Dockerfiles
│       ├── docker-compose/ # Sample compose files
│       └── base-images/  # Sample base image configs
├── package.json          # Node.js package configuration
├── tsconfig.json         # TypeScript configuration
├── jest.config.js        # Jest test configuration
└── .nvmrc                # Node version specification
```

## Contributing

1. All new code must have corresponding tests
2. Tests must pass before merging
3. Follow existing code style and patterns
4. Update this README for significant changes
