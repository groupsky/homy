# Docker Build Change Detection

This directory contains TypeScript tooling (migrated from Python) for detecting which Docker images need to be rebuilt based on file changes in the repository.

## Purpose

The change detection system:
- Analyzes changed files to determine which base images and services are affected
- Builds a dependency graph of Docker images (base images -> services)
- Determines the optimal build order considering dependencies
- Integrates with GHCR to check if images already exist
- Outputs build matrix for GitHub Actions workflows

## Architecture

### Core Components

- **`detect_changes.py`**: Main entry point script
- **`lib/base_images.py`**: Base image discovery and parsing
- **`lib/services.py`**: Service discovery from docker-compose.yml
- **`lib/dockerfile_parser.py`**: Dockerfile parsing and dependency extraction
- **`lib/dependency_graph.py`**: Build dependency graph construction
- **`lib/change_detection.py`**: File change to image mapping logic
- **`lib/ghcr_client.py`**: GHCR API client for image existence checks
- **`lib/version_normalizer.py`**: Version string normalization
- **`lib/healthcheck_parser.py`**: Docker healthcheck parsing and validation
- **`lib/validation.py`**: Configuration validation utilities
- **`lib/output.py`**: Output formatting for GitHub Actions

### Test Structure

- **`tests/test_*.py`**: Unit tests for each module
- **`tests/test_integration.py`**: Integration tests for end-to-end workflows
- **`tests/fixtures/`**: Sample Dockerfiles, compose files, and base-images configs
- **`tests/conftest.py`**: Shared pytest fixtures

## Installation

### TypeScript (Current)

```bash
# Install dependencies
npm install

# Type checking
npm run typecheck
```

### Python (Legacy - being migrated)

```bash
# Install production dependencies
pip install -r requirements.txt

# Install development dependencies (includes testing tools)
pip install -r requirements-dev.txt
```

## Usage

### TypeScript (Current)

```bash
# Detect changes
npm run detect-changes -- detect --base-ref origin/master --sha abc123

# Or with tsx directly
npx tsx src/index.ts detect --base-ref origin/master --sha abc123
```

### Python (Legacy)

```bash
# Detect changes based on git diff
python detect_changes.py --changed-files file1.txt file2.txt

# Output build matrix for GitHub Actions
python detect_changes.py --changed-files file1.txt --output-format github-matrix

# Force rebuild of specific images
python detect_changes.py --force-rebuild base-images/node/Dockerfile

# Dry run mode (no GHCR API calls)
python detect_changes.py --changed-files file1.txt --dry-run
```

## Testing

### TypeScript (Current)

```bash
# Run all tests
npm test

# Watch mode (re-run on changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

### Python (Legacy)

```bash
# Run all tests
pytest

# Run only unit tests
pytest -m unit

# Run with coverage report
pytest --cov=lib --cov-report=html

# Run specific test file
pytest tests/test_dockerfile_parser.py
```

## Development Workflow

This project follows **Test-Driven Development (TDD)**:

1. **Red**: Write a failing test for new functionality
2. **Green**: Implement minimal code to pass the test
3. **Refactor**: Clean up code while keeping tests green

### Adding New Features

1. Create test file in `tests/test_*.py`
2. Write test cases defining expected behavior
3. Run tests to confirm they fail (Red)
4. Implement feature in `lib/*.py`
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

## Migration Status

This project is being incrementally migrated from Python to TypeScript.

### Completed
- ✅ Project structure setup
- ✅ TypeScript type definitions
- ✅ Error classes
- ✅ Jest test configuration

### In Progress
- 🔄 Module migration (Python → TypeScript)

### Pending
- ⏳ Full test suite migration
- ⏳ CLI implementation
- ⏳ GitHub Actions integration

## File Structure

### TypeScript (Current)

```
.github/scripts/detect-changes/
├── src/
│   ├── lib/              # Core libraries
│   │   ├── types.ts      # Shared TypeScript interfaces
│   │   └── ...           # Module implementations (to be migrated)
│   ├── utils/
│   │   ├── errors.ts     # Custom error classes
│   │   └── ...           # Utility functions
│   └── index.ts          # Main CLI entry point
├── tests/
│   ├── lib/              # Unit tests
│   └── fixtures/         # Test fixtures
│       ├── dockerfiles/  # Sample Dockerfiles
│       ├── docker-compose/ # Sample compose files
│       └── base-images/  # Sample base image configs
├── package.json          # Node.js package configuration
├── tsconfig.json         # TypeScript configuration
├── jest.config.js        # Jest test configuration
└── .nvmrc                # Node version specification
```

### Python (Legacy - being phased out)

```
.github/scripts/detect-changes/
├── README.md              # This file
├── requirements.txt       # Production dependencies
├── requirements-dev.txt   # Development/testing dependencies
├── pytest.ini            # Pytest configuration
├── .gitignore            # Python/testing artifacts
├── detect_changes.py     # Main entry point
├── lib/                  # Core detection logic
│   ├── __init__.py
│   ├── base_images.py
│   ├── services.py
│   ├── dockerfile_parser.py
│   ├── dependency_graph.py
│   ├── change_detection.py
│   ├── ghcr_client.py
│   ├── version_normalizer.py
│   ├── healthcheck_parser.py
│   ├── validation.py
│   └── output.py
└── tests/                # Test suite
    ├── __init__.py
    ├── conftest.py
    ├── fixtures/
    ├── test_*.py
    └── test_integration.py
```

## Contributing

1. All new code must have corresponding tests
2. Tests must pass before merging
3. Follow existing code style and patterns
4. Update this README for significant changes
