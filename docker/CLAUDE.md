# Docker Services Development Guide

This directory contains all Docker service implementations for the home automation system.

## Service Development Guidelines

### Creating New Services

When creating a new Docker service:

1. **Create service directory**: Each service should have its own directory under `docker/`
2. **Add Dockerfile**: Include a Dockerfile (may be minimal for existing images)
3. **Create service-specific CLAUDE.md**: Document development patterns and service-specific guidance
4. **Update docker-compose.yml**: Add service configuration to the main compose file

### Dependabot Configuration

**IMPORTANT**: When adding any new Dockerfile to this project (including test containers and minimal ones with just `FROM ...`), you MUST create or update the Dependabot configuration to monitor the container for dependency updates.

#### Steps for Dependabot Setup:
1. Edit `.github/dependabot.yml` in the repository root
2. Add a new entry for the Docker service:
   ```yaml
   - package-ecosystem: "docker"
     directory: "/docker/[service-name]"
     schedule:
       interval: "weekly"
   ```
3. **If the service has application dependencies** (package.json, requirements.txt, go.mod, etc.), add additional entries for those ecosystems:
   ```yaml
   - package-ecosystem: "npm"  # or "pip", "gomod", etc.
     directory: "/docker/[service-name]"
     schedule:
       interval: "weekly"
   ```
4. Ensure the directory path matches the location of your Dockerfile and dependency files

This ensures that both base image updates and application dependency updates are automatically tracked and can be applied through pull requests, even for test containers or services that only use external images.

### Base Images

**RULE**: ALL services MUST use base images from `ghcr.io/groupsky/homy/*` instead of pulling directly from Docker Hub.

**Why**: Avoids Docker Hub rate limits (200 pulls/6h) in CI/CD and enables two-step upgrade workflow.

**Finding Available Base Images**:
- See `base-images/README.md` for complete list of available images
- Check GitHub Container Registry: https://github.com/groupsky?tab=packages&repo_name=homy

**Usage Requirements**:
- Pin to specific versions (e.g., `node:18.20.8-alpine`, NOT `node:18-alpine` or `latest`)
- Base images are pure mirrors - all service customizations go in service Dockerfiles
- For patterns and examples, see `base-images/README.md`

**Documentation**:
- Detailed base images operations: `base-images/CLAUDE.md`
- Usage patterns and examples: `base-images/README.md`
- Two-step upgrade workflow: `base-images/UPGRADE_WORKFLOW.md` (or see base-images/CLAUDE.md)

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