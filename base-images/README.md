# Base Images

This directory contains base images that mirror official Docker images and are published to GitHub Container Registry (GHCR). These pure mirrors are used across all services in the homy project to avoid Docker Hub rate limits.

## GHCR-Only Policy

**MANDATORY**: All Docker services in this project MUST use base images from `ghcr.io/groupsky/homy/*`. Direct pulls from Docker Hub are **prohibited** and enforced via CI validation.

**Enforcement:**
- `.github/workflows/validate-docker-dependencies.yml` validates all Dockerfiles
- Only `ghcr.io/groupsky/homy/*` and `ghcr.io/home-assistant/*` are allowed
- PR builds will fail if non-GHCR base images are detected

## Purpose

By mirroring base images to GHCR, we:
1. **Eliminate Docker Hub rate limits** (200 pulls/6h) that caused frequent CI failures
2. **Enable two-step upgrades**: Test base image updates separately from service updates
3. **Remove external dependencies**: All base layers are controlled and cached in GHCR
4. **Faster CI/CD**: Pre-built layers from GHCR instead of rebuilding from scratch

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
1. Renovate updates `base-images/node-18-alpine/Dockerfile`:
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

4. Services' Renovate detects the new GHCR tag and creates PRs

**No manual updates to `docker-bake.hcl` needed!** ✅

## Renovate Updates

Renovate monitors all base images for upstream image updates weekly (Monday 3 AM UTC). Updates are grouped under the `base-images` group and patch/minor updates are automatically merged after CI validation.

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
