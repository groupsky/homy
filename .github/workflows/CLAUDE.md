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

## Workflow Standards

- Use `actions/checkout@v5.0.0` for consistency
- Place Docker Hub login immediately after checkout
- Use meaningful job and step names
- Include proper error handling and cleanup steps