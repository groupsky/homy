# Test Fixtures for Dockerfile Parsing

This directory contains test fixtures for testing the Docker change detection and build orchestration system.

## Dockerfiles

Located in `dockerfiles/` directory.

### Valid Dockerfile Fixtures

#### `multi_stage_with_healthcheck.dockerfile`
- **Purpose**: Test multi-stage build with full HEALTHCHECK parsing
- **Pattern**: Based on automations service
- **Features**:
  - Three build stages (base, build, release)
  - HEALTHCHECK with all 4 parameters (interval, timeout, start-period, retries)
  - Internal COPY --from between stages
- **Expected parsing**:
  - Base image: `ghcr.io/groupsky/homy/node:18.20.8-alpine`
  - Has HEALTHCHECK: yes
  - HEALTHCHECK params: `--interval=30s --timeout=3s --start-period=40s --retries=3`

#### `single_stage_no_healthcheck.dockerfile`
- **Purpose**: Test simple single-stage build without healthcheck
- **Pattern**: Based on grafana service
- **Features**:
  - Single FROM statement
  - No HEALTHCHECK
  - Basic COPY and RUN commands
- **Expected parsing**:
  - Base image: `ghcr.io/groupsky/homy/grafana:9.5.21`
  - Has HEALTHCHECK: no

#### `healthcheck_two_params.dockerfile`
- **Purpose**: Test HEALTHCHECK with minimal parameters
- **Pattern**: Based on mqtt-influx service
- **Features**:
  - Single stage
  - HEALTHCHECK with only interval and timeout
- **Expected parsing**:
  - Base image: `ghcr.io/groupsky/homy/node:18.20.8-alpine`
  - Has HEALTHCHECK: yes
  - HEALTHCHECK params: `--interval=30s --timeout=10s`

#### `complex_multi_stage.dockerfile`
- **Purpose**: Test complex multi-stage with multiple base images
- **Pattern**: Advanced build scenario
- **Features**:
  - Four build stages
  - Multiple different base images (node, alpine)
  - HEALTHCHECK with all parameters
  - Mix of internal and base dependencies
- **Expected parsing**:
  - Multiple base images detected
  - Has HEALTHCHECK: yes

#### `with_copy_from.dockerfile`
- **Purpose**: Test external COPY --from detection
- **Pattern**: Real-world multi-stage scenario
- **Features**:
  - COPY --from external image (dependency)
  - COPY --from internal stage (no dependency)
- **Expected parsing**:
  - Base images: `ghcr.io/groupsky/homy/node:18.20.8-alpine`, `ghcr.io/groupsky/homy/alpine:3.19`
  - External dependencies detected

#### `home_assistant_exception.dockerfile`
- **Purpose**: Test allowed exception to GHCR-only policy
- **Pattern**: Home Assistant service
- **Features**:
  - Uses `ghcr.io/home-assistant/*` base image
  - Should be allowed despite not matching `ghcr.io/groupsky/homy/*`
- **Expected parsing**:
  - Base image: `ghcr.io/home-assistant/home-assistant:2024.1.0`
  - Should pass validation

### Base Image Fixtures

#### `base_image_exact_copy.dockerfile`
- **Purpose**: Test valid base image (exact copy pattern)
- **Pattern**: Base images in base-images/ directory
- **Features**:
  - Only FROM and LABEL commands
  - No RUN, COPY, or other build steps
- **Expected validation**: PASS (valid base image)

#### `base_image_invalid_with_run.dockerfile`
- **Purpose**: Test invalid base image detection
- **Pattern**: Base image with modifications
- **Features**:
  - Contains RUN command (not allowed in base images)
- **Expected validation**: FAIL (invalid base image)

### Invalid Dockerfile Fixtures

#### `with_arg_in_from.dockerfile`
- **Purpose**: Test detection of parameterized FROM statements
- **Pattern**: Anti-pattern to be rejected
- **Features**:
  - Uses ARG in FROM statement
  - Violates static base image policy
- **Expected validation**: FAIL (ARG in FROM not allowed)

#### `non_ghcr_base.dockerfile`
- **Purpose**: Test detection of non-GHCR base images
- **Pattern**: Policy violation
- **Features**:
  - Uses direct Docker Hub image
  - Violates GHCR-only policy
- **Expected validation**: FAIL (must use ghcr.io/groupsky/homy/*)

## Docker Compose

Located in `docker-compose/` directory.

### `sample-compose.yml`
- **Purpose**: Minimal docker-compose.yml for testing service discovery
- **Pattern**: Based on actual docker-compose.yml structure
- **Features**:
  - Various build configuration patterns:
    - Simple build path: `build: docker/mosquitto`
    - Build with context and dockerfile: `build: { context: ..., dockerfile: ... }`
    - Build with args: `build: { context: ..., args: ... }`
  - Service without build section (pre-built image only)
  - Home Assistant exception case
  - Multiple service types (broker, automation, monitoring, etc.)
- **Expected parsing**:
  - Services with build sections should be detected
  - Dockerfile paths should be resolved correctly
  - Default Dockerfile name should be assumed when not specified

## Usage in Tests

These fixtures should be used in TDD tests for:

1. **Dockerfile parsing**:
   - Base image extraction
   - HEALTHCHECK detection and parameter parsing
   - Multi-stage build analysis
   - External dependency detection (COPY --from)

2. **Validation**:
   - GHCR-only policy enforcement
   - Base image validation (allowed commands)
   - ARG in FROM detection
   - Home Assistant exception handling

3. **Service discovery**:
   - docker-compose.yml parsing
   - Build context resolution
   - Dockerfile path resolution
   - Service dependency mapping

## Adding New Fixtures

When adding new fixtures:

1. Create realistic examples based on actual codebase patterns
2. Document the purpose and expected parsing results
3. Include both positive (valid) and negative (invalid) cases
4. Update this README with the new fixture details
