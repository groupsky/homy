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

For workflows building Docker images, always use Docker Buildx with GitHub Actions cache backend:

#### Single Image Builds (Recommended)

Use `docker/build-push-action` with optimized GitHub Actions cache:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build Docker image
  uses: docker/build-push-action@v6
  with:
    context: ./path/to/build/context
    push: false
    load: true
    tags: image-name
    cache-from: type=gha,scope=service-name
    cache-to: type=gha,mode=max,scope=service-name,ignore-error=true
```

**Note**: Services use pinned base image versions (e.g., `ghcr.io/groupsky/homy/node:18.20.8-alpine`), so `pull: true` is not needed. Renovate manages version updates through separate PRs.

#### Docker Compose Builds

For multi-container builds with docker compose, use `docker compose config` to resolve environment variables:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Generate resolved compose config
  run: |
    docker compose --env-file example.env --file docker-compose.yml config > resolved-docker-compose.yml

- name: Build containers
  uses: docker/bake-action@v6
  with:
    source: .
    files: |
      ./resolved-docker-compose.yml
    set: |
      *.cache-from=type=gha,scope=compose-project
      *.cache-to=type=gha,mode=max,scope=compose-project,ignore-error=true
    load: true
    
- name: Start containers
  run: |
    docker compose --env-file example.env up --no-start
```

**Why docker compose config?**
- **Clean environment**: Doesn't pollute GitHub Actions environment variables
- **Complete resolution**: Handles all variable expansion, defaults, and substitutions
- **Works with any env file**: Can use `example.env`, `.env.production`, etc.
- **Self-contained**: Generated file has all variables resolved and requires no external dependencies
- **Standard approach**: Uses Docker Compose's built-in configuration resolution

**Benefits:**
- **GitHub Actions Cache (`type=gha`)**: Fastest cache backend for GitHub Actions
- **Layer Caching**: Reuses Docker layers between workflow runs
- **Significant Speed Improvements**: Can reduce build times by 90% on cache hits
- **Automatic Cache Management**: GitHub automatically manages cache storage and cleanup

**Important Notes:**
- GitHub Actions cache requires `docker/build-push-action@v6` or later
- Use `load: true` when `push: false` to make images available in local Docker daemon
- Use `mode=max` to cache all intermediate layers (recommended for CI)
- Use unique `scope` values for different services to prevent cache conflicts
- Add `ignore-error=true` to prevent cache export failures from breaking builds
- Cache is automatically shared across workflow runs and branches
- Works only within GitHub Actions environment

**Optimization Parameters:**
- `load: true`: Loads built image into local Docker daemon (required when push: false)
- `scope=service-name`: Creates isolated cache namespace for each service
- `ignore-error=true`: Continues build even if cache export fails
- `mode=max`: Exports all build layers for maximum cache reuse
- `ghtoken=${{ github.token }}`: Uses GitHub token to avoid API rate limiting (optional)

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

## Service-Specific Workflow Patterns

### Node.js Service Testing

**For Node.js services with Jest:**
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version-file: 'docker/service-name/.nvmrc'
    cache: 'npm'
    cache-dependency-path: 'docker/service-name/package-lock.json'

- name: Install dependencies
  working-directory: docker/service-name
  run: npm ci

- name: Run tests
  working-directory: docker/service-name
  run: npm test

- name: Run linting
  working-directory: docker/service-name
  run: npm run lint
```

### Docker Health Check Testing

For services with Docker HEALTHCHECK in Dockerfile, validate the container health status:

```yaml
- name: Verify Docker healthcheck status
  run: |
    # Wait for healthcheck to run multiple times
    sleep 35

    # Check container is marked as healthy or unhealthy (not starting)
    HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' service-name-healthcheck)
    echo "Docker health status: $HEALTH_STATUS"

    if [ "$HEALTH_STATUS" != "healthy" ]; then
      echo "ERROR: Container is not healthy"
      docker inspect --format='{{json .State.Health}}' service-name-healthcheck | jq .
      docker logs service-name-healthcheck
      exit 1
    fi

    echo "✅ Docker healthcheck is working correctly"
```

### Version Consistency Checks

**For services with package.json:**
```yaml
- name: Check version consistency
  working-directory: docker/service-name
  run: |
    DOCKER_VERSION=$(grep 'LABEL version=' Dockerfile | cut -d'"' -f2)
    PACKAGE_VERSION=$(node -p "require('./package.json').version")
    if [ "$DOCKER_VERSION" != "$PACKAGE_VERSION" ]; then
      echo "Version mismatch: Dockerfile=$DOCKER_VERSION, package.json=$PACKAGE_VERSION"
      exit 1
    fi
```

### Test Coverage and Quality Gates

**Recommended quality gates:**
```yaml
- name: Generate test coverage
  working-directory: docker/service-name
  run: npm run test:coverage

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    file: docker/service-name/coverage/lcov.info
    flags: service-name
```

## Unified CI/CD Pipeline

The repository uses a unified CI/CD pipeline (`ci-unified.yml`) that implements a 6-stage architecture for building, testing, and deploying Docker images.

### Migration Status

**Migration Complete**: The unified CI/CD pipeline has replaced all previous fragmented workflows with feature parity. The following workflows have been disabled (renamed to `.disabled`) as their functionality is now fully integrated into `ci-unified.yml`:

**Disabled Workflows and Replacements (9/9):**

| Disabled Workflow | Replacement | Migration Date |
|-------------------|-------------|----------------|
| `base-images.yml.disabled` | Stage 2 (Prepare Base Images) | 2026-01 |
| `app-images.yml.disabled` | Stages 1,3,5,6 (detect, build, push, summary) | 2026-01 |
| `validate-base-images.yml.disabled` | Stage 1 (dynamic discovery) + Stage 2 (runtime validation) | 2026-01 |
| `automations-tests.yml.disabled` | Stage 4B (Unit Tests) | 2026-01 |
| `modbus-serial-tests.yml.disabled` | Stage 4B (Unit Tests) | 2026-01 |
| `telegram-bridge-tests.yml.disabled` | Stage 4B (Unit Tests) + Stage 4C (Health Checks) | 2026-01 |
| `automation-events-processor-tests.yml.disabled` | Stage 4B (Unit Tests) + Stage 4C (Health Checks) | 2026-01 |
| `sunseeker-monitoring-tests.yml.disabled` | Stage 4B (Unit Tests) + Stage 4C (Health Checks) | 2026-01 |
| `lights-test.yml.disabled` | Stage 4D (Lights Integration Test) | 2026-01 |

**Converted to Scheduled Workflows:**

| Workflow | Trigger Changes | Reason |
|----------|----------------|--------|
| `infrastructure.yml` | Push/PR (path-filtered) + Weekly schedule (Mon 2 AM UTC) | Infrastructure validation, not application CI - 86% CI quota savings |
| `routing.yml` | Scheduled only (Mon 3 AM UTC) | Network security boundary testing, infrastructure focus |

**Why These Workflows Were Disabled:**

1. **Race Conditions**: `base-images.yml` and `app-images.yml` both pushed `:latest` tags, creating non-deterministic manifest assignment (last workflow to finish wins)
2. **No Test-Gating**: Previous workflows could push broken builds to `:latest` without test validation
3. **Duplicate Work**: Service test workflows ran redundantly with unified pipeline tests
4. **Inefficient Resource Usage**: Infrastructure tests ran on every commit regardless of changes

**Key Improvements in Unified Pipeline:**

- ✅ **Deterministic Builds**: Single source of truth for `:latest` tags
- ✅ **Test-Gated Promotion**: All Stage 4 tests must pass before `:latest` tagging
- ✅ **Artifact-Based Security**: Build/test stages isolated from registry access
- ✅ **Efficient Change Detection**: Only rebuilds affected services
- ✅ **Cascading Updates**: Base image changes automatically rebuild dependent services

### Architecture Overview

The pipeline consists of 6 sequential stages with parallel execution within stages:

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: Detect Changes                                         │
│ - Analyze git diff to detect changed files                      │
│ - Parse Dockerfiles to extract base image dependencies          │
│ - Check GHCR for existing images                                │
│ - Generate build matrix and retag lists                         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: Prepare Base Images (Sequential)                       │
│ - Pull from Docker Hub → GHCR (or build if Dockerfile exists)   │
│ - Process one at a time to avoid rate limits                    │
│ - Create artifacts with checksums for downstream stages         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3: Build App Images (Parallel, max 10)                    │
│ - Load base images from Stage 2 artifacts                       │
│ - Build app images using matrix strategy                        │
│ - Save images as tar archives with SHA-256 checksums            │
│ - NO packages:write permission (artifact-only)                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│ Stage 3.5: Pull Images for Testing (Parallel, max 10)           │
│ - Pull existing images from GHCR for test-only changes          │
│ - Retag from base SHA to current SHA                            │
│ - Save as artifacts (same format as Stage 3)                    │
│ - Enables testing without unnecessary rebuilds                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│ Stage 4: Tests (4 parallel jobs)                                │
│ 4A: Version Check  4B: Unit Tests  4C: Health Checks  4D: MQTT  │
│ - Dockerfile vs    - npm test      - Container      - Lights    │
│   package.json                        health          integration│
│ - All jobs must pass for promotion to succeed                   │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│ Stage 5: Push and Tag (Test-Gated)                              │
│ 5A: Push Built Images    5B: Retag Unchanged Images             │
│ - Load from artifacts    - Retag existing :latest               │
│ - Push :sha tag          - Only if all tests pass               │
│ - Push :latest (master)  - Parallel processing                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│ Stage 6: Workflow Summary                                       │
│ - Aggregate all stage results                                   │
│ - Send Telegram notifications                                   │
│ - Fail workflow if any critical stage failed                    │
└─────────────────────────────────────────────────────────────────┘
```

### Stage 3.5: Pull Images for Testing

**Purpose**: Optimize CI performance for test-only changes by pulling existing images instead of rebuilding.

**When Stage 3.5 Runs:**

Stage 3.5 activates when the change detection logic identifies services with **test-only changes**:
- Only test files modified (`*.test.js`, `*.spec.ts`, `__tests__/*`)
- Only test configuration changed (`jest.config.js`, `jest.setup.js`)
- Only `devDependencies` changed in `package.json`
- **AND** the service image exists at the base SHA in GHCR

**How It Works:**

1. **Detection Phase** (Stage 1):
   ```typescript
   // Service has changes, but are they test-only?
   if (isTestOnlyChange(baseRef, service)) {
     // Does image exist at base SHA?
     if (imageExistsInGHCR(baseSha)) {
       toPullForTesting.push(service);
     } else {
       toBuild.push(service); // Must build despite test-only change
     }
   }
   ```

2. **Pull Phase** (Stage 3.5):
   ```yaml
   # Pull existing image from base SHA
   docker pull ghcr.io/groupsky/homy/automations:abc123 # base SHA

   # Retag to current SHA for artifact compatibility
   docker tag ghcr.io/groupsky/homy/automations:abc123 \
              ghcr.io/groupsky/homy/automations:def456 # current SHA

   # Save as artifact (identical format to Stage 3)
   docker save ghcr.io/groupsky/homy/automations:def456 -o automations.tar
   sha256sum automations.tar > automations.tar.sha256
   ```

3. **Test Phase** (Stage 4):
   - Tests download artifacts from **either** Stage 3 or Stage 3.5
   - Artifact format is identical, so tests work transparently
   - No changes needed to test jobs

**Test Pattern Detection:**

The following patterns are recognized as test-only changes:

```typescript
const TEST_FILE_PATTERNS = [
  /\.test\.(js|ts|jsx|tsx)$/,    // Jest/Mocha test files
  /\.spec\.(js|ts|jsx|tsx)$/,    // Spec test files
  /\/__tests__\//,               // __tests__ directories
  /\/tests\//,                   // tests directories
  /^jest\.config\.(js|ts)$/,     // Jest configuration
  /^jest\.setup\.(js|ts)$/,      // Jest setup files
  /\.test\.env$/,                // Test environment files
  /^vitest\.config\.(js|ts)$/,   // Vitest configuration
];
```

**Special Handling:**
- **package.json changes**: Only test-only if ONLY `devDependencies` changed
  - Changes to `dependencies`, `scripts`, `version`, `main`, etc. trigger rebuild
  - Script parses JSON to compare base vs. current versions
- **Mixed changes**: Any production file change forces full rebuild
- **Missing base image**: Falls back to rebuild if base SHA image doesn't exist

**Performance Benefits:**

| Scenario | Without Stage 3.5 | With Stage 3.5 | Time Saved |
|----------|-------------------|----------------|------------|
| Test-only change (1 service) | ~7 min | ~3 min | 57% |
| Test-only change (3 services) | ~12 min | ~5 min | 58% |
| Production code change | ~12 min | ~12 min | 0% (no change) |
| Mixed (1 test-only, 2 prod) | ~12 min | ~9 min | 25% |

**Example Scenarios:**

**Scenario 1: Add test coverage**
```bash
# Edit test file
vim docker/automations/bots/irrigation.test.js

# Commit and push
git commit -m "test: Add edge case coverage for irrigation bot"
git push

# CI Behavior:
# ✅ Stage 1: Detects test-only change → adds to toPullForTesting
# ⏩ Stage 3: Skipped (no rebuild needed)
# ✅ Stage 3.5: Pulls existing image, saves as artifact
# ✅ Stage 4: Runs new tests against pulled image
# ✅ Stage 5: Retagging (no new image to push)
```

**Scenario 2: Update Jest configuration**
```bash
# Edit Jest config
vim docker/telegram-bridge/jest.config.js

# CI Behavior:
# ✅ Test-only change detected
# ✅ Pulls existing telegram-bridge image
# ✅ Runs tests with new configuration
# ✅ Promotes if tests pass
```

**Scenario 3: Update devDependencies only**
```bash
# Update testing framework
vim docker/mqtt-influx/package.json
# Only changed: "jest": "^29.0.0" → "jest": "^29.7.0" in devDependencies

# CI Behavior:
# ✅ Detects package.json change
# ✅ Parses JSON to verify only devDependencies changed
# ✅ Classified as test-only change
# ✅ Pulls existing image and runs tests
```

**Scenario 4: Mixed changes (NOT test-only)**
```bash
# Edit both production and test code
vim docker/automations/bots/irrigation.js      # Production
vim docker/automations/bots/irrigation.test.js  # Test

# CI Behavior:
# ❌ NOT test-only (production code changed)
# ✅ Stage 3: Full rebuild
# ✅ Stage 4: Run tests
# ✅ Stage 5: Push new image
```

**Artifact Compatibility:**

Stage 3.5 produces **identical artifact format** to Stage 3:
- **Artifact name**: `service-<service-name>`
- **Contents**:
  - `<service-name>.tar` - Docker image tarball
  - `<service-name>.tar.sha256` - SHA-256 checksum
- **Image tag**: Current SHA (not base SHA)
- **Retention**: 2 days

This ensures Stage 4 test jobs can consume artifacts from either source without modification.

**Error Handling:**

1. **Base image not found in GHCR**:
   ```
   Error: ghcr.io/groupsky/homy/automations:abc123 not found
   ```
   - **Cause**: Base SHA image doesn't exist (possibly deleted or never built)
   - **Solution**: Fallback to rebuild (already handled by detection logic)

2. **Image pull failed (transient)**:
   ```
   Error: manifest unknown
   ```
   - **Retry logic**: 3 attempts with exponential backoff (2s, 4s delays)
   - **Fallback**: Job fails, but build-app-images will rebuild service

3. **Artifact too large**:
   ```
   Error: Image size exceeds 500MB limit
   ```
   - **Validation**: Size check before artifact upload
   - **Solution**: Image optimization or increase limit

**Monitoring:**

Check Stage 3.5 effectiveness in workflow summary:
- **Services to Pull for Testing**: Shows count of test-only services
- **Stage 3.5 Status**: ✅ (success), ⏩ (skipped), or ❌ (failed)
- **Duration**: Typical pull time ~30s per service

### Security Model: Artifact-Based Isolation

**Key Security Principles:**

1. **Minimal Registry Access**: Only Stage 2 and Stage 5 have `packages:write` permission
2. **Artifact-Based Flow**: Stages 2→3→4→5 pass images via artifacts with SHA-256 checksums
3. **No Build-Time Registry Access**: Stage 3 (build) and Stage 4 (tests) cannot pull/push to GHCR
4. **Fork PR Isolation**: Fork PRs cannot access secrets or push to GHCR
5. **Checksum Verification**: Every artifact transfer validated with SHA-256

**Why This Matters:**

- **Supply Chain Security**: Prevents malicious Dockerfiles from pulling/pushing arbitrary images
- **Audit Trail**: All image transfers logged and checksummed
- **Rate Limit Protection**: Single point of registry interaction reduces API calls
- **Cost Control**: Prevents accidental image proliferation

### Test-Gated Promotion

The `:latest` tag promotion is **test-gated**, meaning it only occurs after ALL Stage 4 tests pass:

```yaml
# Stage 5A: Push Built Images
push-built-images:
  needs: [detect-changes, build-app-images, version-consistency-check, unit-tests, healthcheck-tests, lights-integration-test]
  # ↑ Depends on ALL test jobs

# Stage 5B: Retag Unchanged Images
retag-unchanged-images:
  needs: [detect-changes, version-consistency-check, unit-tests, healthcheck-tests, lights-integration-test]
  # ↑ Also depends on ALL test jobs
```

**Stage 4 Test Jobs:**

1. **Stage 4A: Version Consistency Check** - Validates that `package.json` and Dockerfile `LABEL version` match for services with package.json
2. **Stage 4B: Unit Tests** - Runs `npm test` for services with test suites (automations, modbus-serial, telegram-bridge, automation-events-processor, sunseeker-monitoring)
3. **Stage 4C: Healthcheck Tests** - Validates Docker HEALTHCHECK functionality by starting containers and verifying healthy status
4. **Stage 4D: Lights Integration Test** - MQTT integration testing between automations, features, and broker services using docker/test suite

**What This Prevents:**

- ❌ Broken builds being tagged as `:latest`
- ❌ Version inconsistencies in production
- ❌ Failed health checks reaching deployment
- ❌ Untested code being promoted

**What This Allows:**

- ✅ `:sha` tags pushed immediately (for debugging)
- ✅ Test failures block promotion but preserve artifacts
- ✅ Retag operations respect test results
- ✅ Rollback to last known-good `:latest`

### Stage 4D: Lights Integration Test

**Purpose**: Validates end-to-end MQTT message flow between core automation services (automations, features, broker).

**Test Behavior**:
1. Downloads artifacts for automations, broker, and features services
2. Verifies SHA-256 checksums and loads images into Docker daemon
3. Starts services using `docker compose` with `example.env` configuration
4. Waits 30 seconds for service initialization (exact match to previous lights-test.yml)
5. Runs `docker/test/index.js` integration test which:
   - Subscribes to MQTT topics to listen for automation responses
   - Publishes test messages to trigger light automation
   - Validates that automation produces expected output (`out8: true` on `/modbus/dry-switches/relays00-15/write`)
   - Asserts response received within 2-second timeout

**When Stage 4D Runs**:
- Triggered when changes detected in `automations`, `broker`, or `features` services
- Runs in parallel with other Stage 4 tests (4A, 4B, 4C)
- Uses Node.js version from `docker/test/.nvmrc` with npm cache enabled
- Test dependencies installed from `docker/test/package-lock.json`

**Integration with CI Pipeline**:
- **Artifact-Based**: Loads images from tar archives (no registry access)
- **Test-Gated**: Must pass for `:latest` tag promotion
- **Failure Handling**: Captures service logs on failure for debugging
- **Cleanup**: Always stops and removes containers after test

**Environment Configuration**:
```yaml
BROKER: mqtt://localhost  # Points to docker compose broker service
```

**Replaced Workflow**: Previously implemented as standalone `lights-test.yml`, now integrated as Stage 4D for unified test-gating and better resource utilization.

### Node.js Base Image Variants

**Stage 4A (Version Consistency Check)** supports both standard and variant Node.js base images.

**Supported Patterns:**
- **Standard**: `ghcr.io/groupsky/homy/node:18.20.8-alpine`
- **Variant**: `ghcr.io/groupsky/homy/node-ubuntu:18.12.1`
- **Future variants**: `node-alpine:`, `node-slim:`, etc.

**Version Extraction Logic:**

The check uses extended regex to match both patterns (ci-unified.yml line 753):

```bash
# Grep pattern - matches both node: and node-<variant>:
grep -E "^FROM.*node(-[a-z]+)?:" Dockerfile | tail -1

# Sed extraction - captures version from group 2
sed -E 's/.*node(-[a-z]+)?:([0-9.]+).*/\2/'
```

**How It Works:**
- `(-[a-z]+)?` - Optional variant suffix (e.g., `-ubuntu`, `-alpine`, `-slim`)
- Capture group 1: Variant name (may be empty for standard pattern)
- Capture group 2: Version number (always present)
- Returns version from group 2 regardless of variant presence

**Example Extractions:**
```dockerfile
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine → "18.20.8"
FROM ghcr.io/groupsky/homy/node-ubuntu:18.12.1 → "18.12.1"
FROM ghcr.io/groupsky/homy/node-slim:22.22.0 → "22.22.0"
```

**Limitations:**
- ⚠️ Cannot extract from Debian codename suffixes (e.g., `node:18.20.8-bookworm`)
- ⚠️ Supports single-hyphen variants only (e.g., `node-ubuntu:`, not `node-custom-variant:`)
- ✅ All current base images in this repository use supported patterns

**Services Using Variants:**
- None currently. All services use standard Alpine-based Node images.

### Fork PR Handling

Fork PRs have restricted capabilities for security:

| Feature | Main Repo PR | Fork PR |
|---------|-------------|---------|
| Build images | ✅ Yes | ✅ Yes |
| Run tests | ✅ Yes | ✅ Yes |
| Access secrets | ✅ Yes | ❌ No |
| Push to GHCR | ✅ Yes | ❌ No |
| Base image preparation | ✅ Yes | ❌ No* |

\* Fork PRs must have all base images already in GHCR

**Fork PR Workflow:**

1. Fork PR opens → Stage 1 detects changes
2. Stage 2 skipped (no `packages:write` permission)
3. Stage 3 builds using existing GHCR base images
4. Stage 4 runs all tests
5. Stage 5 skipped (no push permission)
6. Stage 6 reports results

**Manual Fork PR Image Publishing:**

Use `workflow_dispatch` with `publish_pr_images=true` to manually publish fork PR images:

```yaml
inputs:
  publish_pr_images: true
  pr_number: "123"
```

This requires repository write access and validates fork PR status.

### Change Detection Logic

Stage 1 uses TypeScript-based detection (`.github/scripts/detect-changes/`) with sophisticated logic:

**Inputs:**
- Git diff between base and head commits
- Dockerfile parsing for base image dependencies
- GHCR existence checks via `docker buildx imagetools`

**Outputs:**
- `changed_services`: Services with Dockerfile/code changes (JSON array)
- `changed_base_images`: Base images with Dockerfile changes (JSON array)
- `base_images_needed`: Dependencies for changed services (JSON array)
- `to_build`: Services requiring build (JSON array)
- `to_retag`: Unchanged services to retag :latest (JSON array)
- `testable_services`: Services with test suites (JSON array)
- `healthcheck_services`: Services with HEALTHCHECK (JSON array)

**Detection Strategy:**

```typescript
// Simplified logic flow
if (serviceDockerfileChanged || serviceCodeChanged) {
  if (!imageExistsInGHCR(sha)) {
    to_build.push(service);
  }

  // Extract base image from Dockerfile
  baseImage = parseDockerfile(service);
  if (!imageExistsInGHCR(baseImage)) {
    base_images_needed.push(baseImage);
  }
} else {
  // Service unchanged, but may need retagging on master
  if (isMasterBranch && imageExistsInGHCR(sha)) {
    to_retag.push(service);
  }
}
```

### Environment Variables

**Required Secrets:**

| Secret | Used In | Purpose |
|--------|---------|---------|
| `GITHUB_TOKEN` | All stages | GHCR authentication (auto-provided) |
| `DOCKER_HUB_USERNAME` | Stage 2 | Docker Hub authentication |
| `DOCKER_HUB_ACCESS_TOKEN` | Stage 2 | Docker Hub authentication |
| `TELEGRAM_BOT_TOKEN` | Stage 2, 6 | Build notifications |
| `TELEGRAM_CHAT_ID` | Stage 2, 6 | Notification recipient |

**Optional Inputs (workflow_dispatch):**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `force_rebuild` | boolean | false | Bypass change detection, rebuild all |
| `publish_pr_images` | boolean | false | Publish fork PR images (requires write access) |
| `pr_number` | string | '' | PR number for fork PR publishing |

### Troubleshooting Guide

#### Build Failures

**Problem: "Base image not found in GHCR"**

```
Error: ghcr.io/groupsky/homy/node:18.20.8-alpine not found
```

**Solution:**
1. Check if base image exists in `base-images/` directory
2. If yes, Stage 2 should have built it - check Stage 2 logs
3. If no, add to `base-images/` and commit
4. For fork PRs: Maintainer must run workflow_dispatch to prepare base images

**Problem: "Artifact checksum mismatch"**

```
Expected: abc123...
Got: def456...
```

**Solution:**
1. Indicates artifact corruption or tampering
2. Re-run workflow - likely transient failure
3. If persistent, check GitHub Actions status

**Problem: "Stage 3 trying to pull from registry"**

```
ERROR: pull access denied for xyz
```

**Solution:**
1. Dockerfile should only reference base images in `base-images/`
2. Check Dockerfile FROM statements
3. Ensure all base images in GHCR via Stage 2

#### Test Failures

**Problem: "Version consistency check failed"**

```
Version mismatch: Dockerfile=1.2.3, package.json=1.2.4
```

**Solution:**
1. Update Dockerfile LABEL version to match package.json
2. Or update package.json to match Dockerfile
3. Versions must be identical

**Problem: "Healthcheck timeout"**

```
Container still in 'starting' state after 35s
```

**Solution:**
1. Check service logs: `docker logs <container>`
2. Verify HEALTHCHECK command in Dockerfile
3. Increase timeout if service has slow startup
4. Ensure service exposes health endpoint

#### Promotion Issues

**Problem: ":latest not updated despite passing tests"**

**Checklist:**
1. Is this a master branch push? (PRs don't get :latest)
2. Did ALL test jobs pass? (Check Stage 4A, 4B, 4C)
3. Check Stage 5 logs for push errors
4. Verify `packages:write` permission granted

**Problem: "Retag failed for unchanged service"**

**Solution:**
1. Check if :sha image exists in GHCR
2. Service may have been changed in previous commits
3. Re-run workflow to rebuild missing images

#### Performance Issues

**Problem: "Workflow taking >30 minutes"**

**Typical Duration:**
- Clean build (all services): ~25 minutes
- Incremental (1-2 services): ~8-12 minutes
- No changes: ~2 minutes (detection only)

**Optimization:**
1. Check Docker layer cache hit rate (should be >80%)
2. Review base image count (Stage 2 is sequential)
3. Consider splitting large services
4. Check for excessive test execution time

### Monitoring and Metrics

**Key Performance Indicators:**

| Metric | Target | Red Flag |
|--------|--------|----------|
| Workflow duration (incremental) | <12 min | >20 min |
| Workflow duration (full rebuild) | <30 min | >45 min |
| Docker cache hit rate | >80% | <50% |
| Test execution time | <5 min | >10 min |
| Base image preparation | <3 min | >10 min |

**GitHub Actions Quotas:**

- Free tier: 2,000 min/month for private repos
- Estimated usage: ~1,640 min/month (82% of quota)
- Cache limit: 10GB (currently at ~10GB)

**Cost Optimization:**
- Enable Docker layer caching (saves 8 min/build)
- Prune old cache entries regularly
- Use `ignore-error=true` on cache exports
- Consider composite actions for repeated patterns

### Development Workflow Examples

**Scenario 1: Add new service**

1. Create `docker/new-service/Dockerfile`
2. Add service to `docker-compose.yml`
3. Commit and push
4. Workflow auto-detects:
   - New base image dependency → Stage 2 prepares
   - New service → Stage 3 builds
   - Tests → Stage 4 runs (if applicable)
   - Master push → Stage 5 tags :latest

**Scenario 2: Update existing service**

1. Modify `docker/existing-service/index.js`
2. Commit and push
3. Workflow:
   - Detects code change → rebuilds only that service
   - Other services → retagged (no rebuild)
   - Tests run → promotion gated on success

**Scenario 3: Update base image**

1. Modify `base-images/node/Dockerfile` (18.20.8 → 18.20.9)
2. Commit and push
3. Workflow:
   - Stage 2 builds new base image
   - Stage 3 rebuilds ALL services using that base
   - Cascading update ensures consistency

**Scenario 4: Fork PR contribution**

1. Fork repository
2. Make changes
3. Open PR
4. Workflow:
   - Builds images (if base images exist in GHCR)
   - Runs tests
   - No GHCR push (security boundary)
5. Maintainer reviews and merges
6. Master build publishes images

### Best Practices

**When Adding New Services:**

1. ✅ Use base images from `ghcr.io/groupsky/homy/*`
2. ✅ Add HEALTHCHECK to Dockerfile if service has health endpoint
3. ✅ Include version LABEL in Dockerfile
4. ✅ Add npm test script if Node.js service
5. ✅ Update documentation

**When Updating Dependencies:**

1. ✅ Let Renovate handle base image updates
2. ✅ Test locally before pushing
3. ✅ Monitor workflow for cascading rebuild impact
4. ✅ Review test results before merging

**When Debugging Build Failures:**

1. ✅ Check Stage 1 outputs for detection logic
2. ✅ Verify base images exist in GHCR
3. ✅ Review artifact checksums
4. ✅ Inspect Dockerfile FROM statements
5. ✅ Run locally with `docker compose build`

### Advanced Features

**Force Rebuild All Images:**

Use `workflow_dispatch` with `force_rebuild=true`:

```bash
gh workflow run ci-unified.yml \
  --ref master \
  -f force_rebuild=true
```

**Publish Fork PR Images:**

Requires repository write access:

```bash
gh workflow run ci-unified.yml \
  --ref master \
  -f publish_pr_images=true \
  -f pr_number=123
```

**Manual Retag Operation:**

Stage 5B handles automatic retagging, but for manual operations:

```bash
# Retag existing :sha to :latest
docker buildx imagetools create \
  --tag ghcr.io/groupsky/homy/service:latest \
  ghcr.io/groupsky/homy/service:abc123def
```

### Related Documentation

- **Base Images**: `base-images/CLAUDE.md` - Base image management and Renovate workflow
- **Project Root**: `CLAUDE.md` - Docker base image policy and GHCR-only requirement
- **Architecture**: `ARCHITECTURE.md` - System architecture and data flow
