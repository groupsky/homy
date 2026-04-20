# Docker Services Development Guide

This directory contains all Docker service implementations for the home automation system.

## Service Development Guidelines

### Creating New Services

When creating a new Docker service:

1. **Create service directory**: Each service should have its own directory under `docker/`
2. **Add Dockerfile**: Include a Dockerfile (may be minimal for existing images)
3. **Create service-specific CLAUDE.md**: Document development patterns and service-specific guidance
4. **Update docker-compose.yml**: Add service configuration to the main compose file

### Renovate Configuration

**IMPORTANT**: When adding any new service to this project, you MUST update the Renovate configuration to monitor the service for dependency updates.

#### Steps for Renovate Setup:
1. Edit `renovate.json` in the repository root
2. Add the service path to the appropriate group's `matchPaths` array:
   ```json
   {
     "description": "Choose appropriate group: infrastructure, mqtt-services, hardware-integration, monitoring, or home-automation",
     "matchPaths": [
       "docker/existing-service/**",
       "docker/[your-new-service]/**"
     ],
     "groupName": "mqtt-services",
     "schedule": ["before 3am on Monday"]
   }
   ```
3. The `matchPaths` pattern `docker/[service-name]/**` automatically covers:
   - Dockerfile (Docker base image updates)
   - package.json (npm dependency updates)
   - Other dependency files in the service directory

**Service Groups:**
- `infrastructure` - Core services (nginx, mosquitto, influxdb, grafana, mongo)
- `mqtt-services` - Message processing (automations, mqtt-influx, mqtt-mongo)
- `hardware-integration` - Device communication (modbus-serial, dmx-driver, telegram-bridge)
- `monitoring` - Data collection (historian, sunseeker-monitoring)
- `home-automation` - User interface (homeassistant)

This ensures that both base image updates and application dependency updates are automatically tracked via Renovate PRs.

### Base Images - GHCR-Only Policy

**CRITICAL RULE**: ALL services MUST use base images from `ghcr.io/groupsky/homy/*` exclusively. Direct pulls from Docker Hub are **PROHIBITED** and will fail CI validation.

**Why This Policy Exists:**
- **Eliminates Docker Hub rate limits** (200 pulls/6h) that caused frequent CI failures
- **Enables two-step dependency upgrades** via Renovate (base image → service)
- **Centralized version control** for all base dependencies
- **Faster CI/CD** through GHCR caching and no external dependencies

**Policy Enforcement:**
- `.github/workflows/validate-docker-dependencies.yml` runs on every PR
- Scans all `docker/*/Dockerfile` files for non-GHCR base images
- Only approved patterns: `ghcr.io/groupsky/homy/*` and `ghcr.io/home-assistant/*`
- **Violations block PR merge**

**Correct Usage:**
```dockerfile
# ✅ CORRECT - GHCR base images with pinned versions
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine
FROM ghcr.io/groupsky/homy/grafana:9.5.21
FROM ghcr.io/groupsky/homy/alpine:3.22.1

# ❌ WRONG - Docker Hub pulls are blocked
FROM node:18.20.8-alpine
FROM grafana/grafana:9.5.21
FROM alpine:3.22.1
```

**Version Pinning Requirements:**
- ✅ Pin to specific versions: `ghcr.io/groupsky/homy/node:18.20.8-alpine`
- ❌ Never use floating tags: `ghcr.io/groupsky/homy/node:18-alpine`, `latest`
- Base images are pure mirrors - service customizations go in service Dockerfiles

**Finding Available Base Images:**
- **Primary source**: `base-images/README.md` - Complete list of available images
- **Registry**: https://github.com/groupsky?tab=packages&repo_name=homy
- **Quick reference**: Common images include node, grafana, influxdb, mosquitto, mongo, alpine, nginx, ubuntu

**Documentation:**
- **Policy & Operations**: `base-images/CLAUDE.md` - Creating and managing base images
- **Usage Examples**: `base-images/README.md` - Service Dockerfile patterns
- **Dependency Updates**: `renovate.json` - Renovate configuration for automated updates

### Service Types

**Production Services**: Services that run in the main docker-compose setup
**Test Containers**: Testing-only services that may have separate compose files
**Custom Services**: Full application code with complex Dockerfiles
**External Image Services**: Services using existing images with minimal Dockerfile for version pinning

### Service Structure

Each service directory should contain:
- `Dockerfile` - Container definition (minimal or complex)
- `CLAUDE.md` - Development and configuration guidance (for production services)
- Service-specific code and configuration files (for custom services)
- Any required dependencies or assets

### Integration Requirements

For production services:
- All services must integrate with the MQTT broker for communication
- Follow existing naming conventions for MQTT topics
- Use environment variables for configuration that may vary between environments
- Implement proper health checks where applicable
- Use Docker secrets pattern for sensitive configuration

## Common Development Patterns

### Test-Driven Development

**Recommended Approach:**
1. Write comprehensive tests before implementation
2. Follow Red-Green-Refactor cycle
3. Test external integrations with proper mocking
4. Create standalone health check scripts for Docker

### Code Organization

**Best Practices:**
- Extract constants and magic values to dedicated files
- Create utilities modules for common functions (secrets, validation)
- Implement standardized logging with consistent formatting
- Use centralized error handling with proper context

### Configuration Management

**Docker Secrets Pattern:**
- Support both direct environment variables and `_FILE` variants
- Implement consistent secret loading utilities
- Validate configuration early with descriptive error messages
- Use meaningful prefixes for environment variables

### External Service Integration

**MQTT Integration:**
- Implement proper connection recovery mechanisms
- Handle partial data gracefully
- Provide connection health tracking
- Never log sensitive data

**Database Integration:**
- Use appropriate data modeling for time-series data
- Batch writes for efficiency where possible
- Include proper error handling and retry logic
- Implement health checks for database connections

### Testing Standards

**JavaScript Services Testing:**
- **IMPORTANT**: Use Jest as the primary testing framework for JavaScript services
- **IMPORTANT**: Use MSW (Mock Service Worker) for mocking HTTP and network requests instead of manual mocking
- **IMPORTANT**: Use proper test constants to avoid real data in tests
- Create comprehensive test coverage with unit tests, integration tests, and end-to-end tests
- Never use real credentials, device IDs, or sensitive data in tests

**Test Structure:**
- Create `test-constants.js` file for all test data and configuration
- Use descriptive test names that explain the expected behavior
- Implement proper setup and teardown for test environments
- Avoid arbitrary timeouts - use proper async/await patterns or mocking
- Test error scenarios and edge cases comprehensively

**MSW Usage:**
- Set up MSW handlers for external API calls
- Mock MQTT brokers and database connections using MSW where applicable
- Use realistic test data that mirrors production structure without real values
- Implement request/response validation in MSW handlers

### Performance and Reliability

**Production Considerations:**
- Implement graceful degradation for external service failures
- Provide meaningful error messages and logging
- Handle edge cases and malformed data
- Include metrics and monitoring capabilities

### Node.js npm Installation

**For Node.js services using npm in Dockerfiles:**

**npm 8.0+ (Node 16+)**: Use `--omit=dev` to exclude development dependencies
```dockerfile
RUN npm ci --omit=dev
```

**npm 7.x and earlier**: Use `--only=production` (deprecated in npm 8.0+)
```dockerfile  
RUN npm ci --only=production
```

**Note**: npm 8.0+ will show warnings when using `--only=production`:
```
npm WARN config only Use `--omit=dev` to omit dev dependencies from the install.
```

Use `--omit=dev` for all new services and update existing services when upgrading Node.js base images to v16 or later.