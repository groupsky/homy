# Base Images

This directory contains base images that mirror official Docker images and are published to GitHub Container Registry (GHCR). These pure mirrors are used across all services in the homy project to avoid Docker Hub rate limits.

## Purpose

By mirroring base images to GHCR, we:
1. **Avoid Docker Hub rate limits** (200 pulls/6h) in CI/CD pipelines
2. **Enable two-step upgrades**: Test base image updates separately from service updates
3. **Reduce Docker Hub API calls**: Only pull from Docker Hub once per base image update

## Available Images

**Finding available base images:**
- List directories: `ls base-images/` (each directory is a base image)
- Check versions: `grep "FROM" base-images/*/Dockerfile`
- View published packages: https://github.com/groupsky?tab=packages&repo_name=homy
- See workflow configuration: `.github/workflows/base-images.yml`

## Building Locally

Build all images:
```bash
cd base-images
docker buildx bake
```

Build specific image:
```bash
cd base-images
docker buildx bake node-18-alpine
```

## CI/CD Pipeline

Base images are automatically built and pushed to GHCR when:
- Changes are pushed to `master` branch in `base-images/` directory
- Pull requests modify files in `base-images/` directory (build only, no push)
- Manually triggered via workflow dispatch

The workflow uses:
- Docker Hub authentication for pulling upstream images
- GHCR authentication for publishing built images
- GitHub Actions cache for layer caching
- **Dynamic version extraction** from Dockerfiles (no manual tag updates needed!)

### Automated Versioning

**Key feature**: Versions are extracted automatically from Dockerfiles, so Dependabot PRs work without manual intervention.

**How it works:**
1. Dependabot updates `base-images/node-18-alpine/Dockerfile`:
   ```diff
   - FROM node:18.20.8-alpine
   + FROM node:18.20.9-alpine
   ```

2. CI extracts the version from the Dockerfile:
   ```bash
   VERSION=$(grep "FROM node:" Dockerfile | cut -d: -f2)
   # Result: "18.20.9-alpine"
   ```

3. CI publishes with extracted version:
   ```
   ghcr.io/groupsky/homy/node:18.20.9-alpine
   ```

4. Services' Dependabot detects the new GHCR tag and creates PRs

**No manual updates to `docker-bake.hcl` needed!** ✅

## Dependabot Updates

Dependabot monitors each base image directory for upstream image updates weekly. Updates are grouped under the `base-images` group for easy review.

## Using Base Images

In service Dockerfiles, reference the GHCR images:

```dockerfile
FROM ghcr.io/groupsky/homy/node:18-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
```

## Base Images Are Pure Mirrors

**Important**: Base images are pure mirrors of upstream images - they contain NO customizations.

All service-specific setup (user creation, build tools, healthchecks) goes in the service Dockerfiles, not in base images. This design:
- Makes base images simple and maintainable
- Gives services full control over their configuration
- Reduces coupling between base images and services

## Updating Base Images

To update a base image:
1. Modify the Dockerfile in the appropriate directory
2. Commit and push to trigger CI/CD
3. Once published, update service Dockerfiles if needed
4. Test service builds with the new base image

## Migration from Docker Hub

This transition moves all services from pulling directly from Docker Hub to using mirrored images from GHCR, significantly reducing Docker Hub API calls during CI/CD and avoiding rate limits.

**Before:**
```dockerfile
FROM node:18.20.8-alpine AS base
```

**After:**
```dockerfile
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
```

**Note**: Service Dockerfiles keep all their setup (user creation, build tools, etc.) - only the FROM line changes.
