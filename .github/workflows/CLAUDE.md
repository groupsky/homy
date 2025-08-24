# CLAUDE.md - GitHub Workflows

This file provides guidance to Claude Code when working with GitHub Actions workflows in this repository.

## Docker Hub Authentication

**IMPORTANT**: All workflows that build or interact with Docker images MUST include Docker Hub login before any Docker operations.

### Required Login Step

Always add the following step before building, pulling, or pushing Docker images:

```yaml
- name: Login to Docker Hub
  uses: docker/login-action@v3
  with:
    username: ${{ secrets.DOCKER_HUB_USERNAME }}
    password: ${{ secrets.DOCKER_HUB_ACCESS_TOKEN }}
```

### When to Add Docker Hub Login

Add Docker Hub login to workflows that:
- Build Docker images (`docker build`)
- Use docker compose with build operations
- Pull from private Docker repositories
- Push images to Docker Hub
- Run Docker containers that may need private image access

### Required Secrets

Ensure these secrets are configured in the repository settings:
- `DOCKER_HUB_USERNAME` - Docker Hub username
- `DOCKER_HUB_ACCESS_TOKEN` - Docker Hub access token (not password)

### Example Workflow Structure

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v5.0.0
        
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_HUB_USERNAME }}
          password: ${{ secrets.DOCKER_HUB_ACCESS_TOKEN }}
        
      - name: Build Docker image
        run: docker build -t my-image .
```

## Caching Best Practices

**IMPORTANT**: Always implement appropriate caching to improve workflow performance and reduce CI costs.

### Node.js and npm Caching

For workflows using Node.js, always enable built-in npm caching with `setup-node`:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version-file: 'path/to/.nvmrc'
    cache: 'npm'
    cache-dependency-path: 'path/to/package-lock.json'
```

**Key Points:**
- Use `cache: 'npm'` (or 'yarn', 'pnpm') to enable dependency caching
- Specify `cache-dependency-path` when package-lock.json is not in repository root
- The setup-node action uses `actions/cache` internally with optimized cache keys
- Never cache `node_modules` directly - use the package manager cache instead

### Docker Build Caching

For workflows building Docker images, always use Docker Buildx with BuildKit:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build Docker image
  run: |
    export DOCKER_BUILDKIT=1
    docker build -t image-name .
```

**Benefits:**
- Enables advanced Docker BuildKit features
- Improves build performance through better layer caching
- Supports multi-platform builds and advanced cache backends
- Required for GitHub Actions cache integration with Docker

### Arduino CLI Caching

For Arduino workflows, cache the CLI installation and libraries:

```yaml
- name: Cache Arduino CLI and libraries
  uses: actions/cache@v4
  with:
    path: |
      ~/.arduino15
      ~/Arduino/libraries
    key: arduino-${{ runner.os }}-${{ hashFiles('arduino/arduino.ino') }}
    restore-keys: |
      arduino-${{ runner.os }}-
```

### When to Use Caching

Apply caching to workflows that:
- Install Node.js dependencies (`npm ci`, `yarn install`)
- Build Docker images
- Install system packages or tools (Arduino CLI, etc.)
- Download or compile dependencies that don't change frequently

### Cache Action Version Requirements

**IMPORTANT**: Use `actions/cache@v4` or later. GitHub will only support Cache service API v2 starting April 15th, 2025. Older versions will stop working.

## Workflow Standards

- Use `actions/checkout@v5.0.0` for consistency
- Place Docker Hub login immediately after checkout
- Always add appropriate caching based on the technology stack
- Use meaningful job and step names
- Include proper error handling and cleanup steps