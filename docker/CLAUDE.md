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

This ensures that both base image updates and application dependency updates are automatically tracked and can be applied through pull requests, even for test containers or services that only use existing images.

### Service Types

**Production Services**: Services that run in the main docker-compose setup
**Test Containers**: Testing-only services that may have separate compose files
**Custom Services**: Full application code with complex Dockerfiles
**Existing Image Services**: May only contain a minimal Dockerfile with `FROM [image]` to enable version pinning and Dependabot monitoring

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