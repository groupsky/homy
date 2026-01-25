# CLAUDE.md - Base Images

This file provides guidance for Claude Code when working with base images in this repository.

## Overview

Base images are custom Docker images built on top of official upstream images (Node.js, Grafana, InfluxDB, etc.) and published to GitHub Container Registry (GHCR). These images serve as the foundation for all services in the homy project.

## GHCR-Only Policy

**CRITICAL**: This project enforces a **strict GHCR-only policy** for all Docker base images. Direct pulls from Docker Hub are prohibited.

**Policy Enforcement:**
- `.github/workflows/validate-docker-dependencies.yml` scans all Dockerfiles on every PR
- Only `ghcr.io/groupsky/homy/*` and `ghcr.io/home-assistant/*` base images are allowed
- Violations fail CI and block PR merge

## Why Base Images?

1. **Eliminate Docker Hub Rate Limits**: GitHub Actions has strict Docker Hub rate limits (200 pulls/6h authenticated) that caused frequent CI failures. By using GHCR exclusively, we eliminate these limits entirely.

2. **Two-Step Dependency Updates**: Dependabot creates separate PRs:
   - **Step 1**: Update base image Dockerfile → CI pulls from Docker Hub once → publishes to GHCR
   - **Step 2**: Update service Dockerfiles → CI pulls from GHCR → zero Docker Hub calls

3. **Centralized Common Configuration**: User setup, build tools, and common dependencies are defined once in base images, reducing duplication across services.

4. **Faster CI/CD**: Services pull pre-built base layers from GHCR instead of building from scratch.

5. **No External Dependencies**: All base images are mirrored to GHCR, eliminating reliance on external registries.

## Architecture

### Directory Structure

```
base-images/
├── node-18-alpine/          # Node.js 18 Alpine base
│   └── Dockerfile
├── node-22-alpine/          # Node.js 22 Alpine base
│   └── Dockerfile
├── grafana/                 # Grafana with healthcheck
│   └── Dockerfile
├── influxdb/                # InfluxDB with healthcheck
│   └── Dockerfile
├── mosquitto/               # Mosquitto MQTT broker
│   └── Dockerfile
├── mongo/                   # MongoDB database
│   └── Dockerfile
├── docker-bake.hcl          # Multi-image build configuration
├── README.md                # User-facing documentation
├── UPGRADE_WORKFLOW.md      # Detailed upgrade workflow guide
└── CLAUDE.md                # This file - operations guide
```

### Finding Available Base Images

See `base-images/README.md` for how to discover available images dynamically.

## Adding a New Base Image

When you need to create a new base image:

### 1. Create Base Image Directory

```bash
mkdir base-images/new-image-name
cd base-images/new-image-name
```

### 2. Create Dockerfile

Create a minimal Dockerfile that extends the upstream image:

```dockerfile
FROM upstream-image:version

# Add only common configurations that ALL services using this base will need
# Keep it minimal - service-specific changes go in service Dockerfiles

# Example for Node.js base:
RUN apk add --no-cache build-base linux-headers udev python3

RUN set -ex && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    adduser -h /usr/src/app -D -H node-app -u 1000 && \
    addgroup node-app dialout && \
    chown -R node-app:node-app /usr/src/app

WORKDIR /usr/src/app
```

**Important Principles:**
- Keep base images **minimal** - only include what's truly common
- Avoid service-specific customizations
- Document why each RUN command is necessary

### 3. Add to docker-bake.hcl

Edit `base-images/docker-bake.hcl` and add the new target:

```hcl
group "default" {
  targets = [
    # ... existing targets
    "new-image-name"
  ]
}

target "new-image-name" {
  context = "./new-image-name"
  # Tags set via workflow: ghcr.io/groupsky/homy/new-image:${VERSION}
}
```

### 4. Update base-images Workflow

Edit `.github/workflows/base-images.yml`:

**Add version extraction:**
```yaml
- name: Extract versions from Dockerfiles
  id: versions
  run: |
    cd base-images
    # ... existing extractions
    NEW_IMAGE=$(grep "FROM upstream-image:" new-image-name/Dockerfile | cut -d: -f2)
    echo "new_image=$NEW_IMAGE" >> $GITHUB_OUTPUT
```

**Add to build step:**
```yaml
set: |
  # ... existing tags
  new-image-name.tags=ghcr.io/groupsky/homy/new-image:${{ steps.versions.outputs.new_image }}
```

**Add to verification step:**
```yaml
echo "  ghcr.io/groupsky/homy/new-image:X.Y.Z"
```

### 5. Configure Dependabot

Add to `.github/dependabot.yml`:

```yaml
- package-ecosystem: "docker"
  directory: "/base-images/new-image-name"
  schedule:
    interval: "weekly"
  reviewers:
    - "groupsky"
  groups:
    base-images:
      patterns:
        - "*"
```

### 6. Document in README

Update `base-images/README.md` to list the new base image in the "Available Images" table.

### 7. Test Locally

```bash
cd base-images
docker buildx bake new-image-name
```

### 8. Commit and Push

Commit all changes and push. The GitHub Actions workflow will build and publish the image on merge to master.

## Updating Existing Base Images

### Automated Updates (Preferred)

Dependabot automatically detects upstream image updates and creates PRs weekly. When a Dependabot PR is created:

1. **Review the PR**: Check the upstream changelog for breaking changes
2. **CI automatically**:
   - Builds the updated base image
   - Pushes to GHCR with the new version tag
   - Runs validation checks
3. **Merge the PR**: Base image is now available at the new version
4. **Wait for service PRs**: Dependabot will detect the new GHCR tag and create separate PRs to update services

**No manual updates to docker-bake.hcl needed!** The workflow extracts versions dynamically from Dockerfiles.

### Manual Updates

If you need to update a base image manually:

1. Edit the Dockerfile in `base-images/image-name/Dockerfile`
2. Update the `FROM` line to the new version
3. Commit and push to master
4. CI will automatically:
   - Extract the new version from the Dockerfile
   - Build and publish with the new tag
   - Make it available for services to use

## Using Base Images in Services

### Node.js Services

For Node.js services, use the appropriate Node base image:

```dockerfile
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app

COPY package*.json ./

#### Stage BUILD
FROM base AS build

RUN npm ci --omit=dev && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

USER node-app

ENTRYPOINT ["node", "index.js"]
```

**Key Points:**
- Pin to specific version (e.g., `18.20.8-alpine`, not `18-alpine`)
- Use `node-app` user (uid 1000), not `node`
- `/usr/src/app` is the standard workdir
- Build tools are already available for npm native modules

### Infrastructure Services

For infrastructure services (Grafana, InfluxDB, etc.):

```dockerfile
FROM ghcr.io/groupsky/homy/grafana:9.5.21

# Add service-specific configurations
COPY grafana.ini /etc/grafana/grafana.ini
COPY provisioning/ /etc/grafana/provisioning/
```

### Service-Specific Modifications

If a service needs something beyond what the base provides:

```dockerfile
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

# Add service-specific packages
RUN apk add --no-cache imagemagick

# Rest of Dockerfile...
```

**Don't add these to the base image unless ALL services need them.**

## All Services Use GHCR Base Images

All services now use base images from GHCR to avoid Docker Hub rate limits. Even third-party platforms like Grafana and Mosquitto are republished to GHCR for consistency and rate limit avoidance.

## Automated Workflow Explained

### Base Images Workflow

**Trigger**: Changes to `base-images/` or workflow file
**File**: `.github/workflows/base-images.yml`

**Steps:**
1. **Extract versions**: Parse each Dockerfile's FROM line to get upstream version
2. **Build images**: Use `docker buildx bake` to build all base images in parallel
3. **Tag images**: Apply tags using extracted versions (e.g., `ghcr.io/groupsky/homy/node:18.20.8-alpine`)
4. **Push to GHCR**: Publish images to GitHub Container Registry (master branch only)
5. **Cache layers**: Use GitHub Actions cache for faster rebuilds

**Key Feature**: Version extraction is dynamic - no manual updates to docker-bake.hcl needed!

### Validation Workflows

**Validate Base Images** (`.github/workflows/validate-base-images.yml`):
- Checks each base image has a Dockerfile
- Verifies Dependabot configuration
- Validates docker-bake.hcl targets
- Ensures workflow extracts versions
- Confirms README documentation

**Validate Docker Dependencies** (`.github/workflows/validate-docker-dependencies.yml`):
- Scans all `docker/*/Dockerfile` files
- Ensures services use GHCR base images or approved external images
- Prevents accidental use of Docker Hub node: images
- Enforces base image usage policy

## Troubleshooting

### "Image not found" Error in Service Build

**Problem**: Service Dockerfile references a version that doesn't exist in GHCR.

**Solution**:
1. Check what versions are available: Visit `https://github.com/groupsky/homy/pkgs/container/node`
2. Update service Dockerfile to use an available version
3. Or wait for base-images workflow to publish the new version

### Base Image Build Fails

**Problem**: Base image fails to build in CI.

**Common Causes**:
- Upstream image version doesn't exist
- Typo in Dockerfile FROM line
- Network issues pulling from Docker Hub

**Solution**:
1. Check the workflow logs for specific error
2. Verify upstream image exists on Docker Hub
3. Test build locally: `cd base-images && docker buildx bake image-name`

### Service Still Pulling from Docker Hub

**Problem**: Service builds are still hitting Docker Hub rate limits.

**Check**:
1. Verify service Dockerfile uses `ghcr.io/groupsky/homy/*` in FROM line
2. Check that the version exists in GHCR
3. Ensure no `pull: true` in service's test workflow (not needed with pinned versions)

### Dependabot Not Creating PRs

**Problem**: Dependabot isn't detecting base image updates.

**Solution**:
1. Check `.github/dependabot.yml` has entry for the base image
2. Verify directory path matches exactly: `/base-images/image-name`
3. Ensure `package-ecosystem: "docker"` is set
4. Check Dependabot logs in GitHub's Insights > Dependency graph > Dependabot

### Version Extraction Fails

**Problem**: Workflow fails with "Cannot extract version from Dockerfile".

**Solution**:
1. Check Dockerfile has a valid `FROM` line
2. Ensure FROM line format is: `FROM registry/image:version`
3. Test locally: `grep "^FROM " Dockerfile | awk '{print $2}' | cut -d: -f2`

## Best Practices

### Base Image Design

1. **Keep it minimal**: Only include what's truly common across services
2. **Document rationale**: Explain why each RUN command exists
3. **Avoid service-specific logic**: Service customizations go in service Dockerfiles
4. **Pin upstream versions**: Always use specific versions, not floating tags
5. **Test thoroughly**: Build locally before pushing

### Service Integration

1. **Use pinned versions**: Reference specific versions (e.g., `18.20.8-alpine`)
2. **Trust the base**: Don't duplicate setup that's in the base image
3. **No redundant comments**: Don't comment "already in base image"
4. **Follow conventions**: Use `node-app` user, `/usr/src/app` workdir
5. **Override when needed**: Add service-specific requirements explicitly

### Workflow Management

1. **Let Dependabot work**: Automated updates are preferred over manual
2. **Review changelogs**: Always check upstream changes before merging
3. **Test in CI**: Rely on CI validation before merging
4. **Monitor GHCR quota**: Check GitHub Packages storage usage periodically

### Documentation

1. **Update README**: Document new base images in the table
2. **Update UPGRADE_WORKFLOW.md**: If workflow changes affect upgrade process
3. **Update this file**: When adding new patterns or troubleshooting steps
4. **Keep examples current**: Update example Dockerfiles when patterns change

## Related Documentation

- **base-images/README.md**: User-facing base images documentation
- **base-images/UPGRADE_WORKFLOW.md**: Detailed two-step upgrade workflow
- **docker/CLAUDE.md**: Docker services development guide with base images guidance
- **.github/workflows/CLAUDE.md**: GitHub Actions workflow patterns

## Quick Reference

### Common Commands

```bash
# Build all base images locally
cd base-images && docker buildx bake

# Build specific base image
cd base-images && docker buildx bake node-18-alpine

# Test version extraction
grep "FROM " base-images/node-18-alpine/Dockerfile | cut -d: -f2

# Check what's published in GHCR
gh api /orgs/groupsky/packages/container/node/versions
```

### File Locations

- Base image Dockerfiles: `base-images/*/Dockerfile`
- Build configuration: `base-images/docker-bake.hcl`
- CI workflow: `.github/workflows/base-images.yml`
- Dependabot config: `.github/dependabot.yml`
- Validation workflows: `.github/workflows/validate-*.yml`

### Environment Variables

Base images CI workflow uses these secrets:
- `DOCKER_HUB_USERNAME`: For pulling from Docker Hub
- `DOCKER_HUB_ACCESS_TOKEN`: Docker Hub authentication
- `GITHUB_TOKEN`: For pushing to GHCR (automatically provided)
