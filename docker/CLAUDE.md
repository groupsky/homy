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

## Lessons Learned from Service Development

### TDD Development with Node.js Services

**Test-First Development Approach** - From developing the **mqtt-influx-sunseeker** service:

1. **Write Tests First**: Create comprehensive Jest tests before implementation
   - Message parser tests defining expected behavior
   - Integration tests for MQTT-InfluxDB flow  
   - Health check tests for Docker monitoring

2. **Red-Green-Refactor Cycle**: 
   - **Red**: Tests fail initially (expected)
   - **Green**: Implement minimal code to pass tests
   - **Refactor**: Extract constants, utilities, improve structure

### Code Organization Patterns

**Successful patterns:**
- **Constants extraction**: All magic numbers/strings moved to `constants.js`
- **Utilities module**: Common functions like Docker secrets, validation
- **Standardized logging**: Consistent emoji-prefixed logging with context
- **Error handling**: Centralized error creation with proper context

### Configuration Management

**Docker Secrets Pattern:**
- Support both direct env vars and `_FILE` variants  
- Implement `loadSecret()` utility for consistent secret loading
- Validate configuration early with clear error messages
- Use descriptive prefixes: `MQTT_`, `INFLUX_` for clarity

### Service Integration

**Docker Compose Integration:**
- Follow existing network patterns (automation, egress)
- Use existing secrets where possible (influxdb_write_user)
- Maintain security with `no-new-privileges:true`
- Add new secrets only when necessary

**InfluxDB Data Modeling:**
- Use measurement names that clearly indicate data type
- Leverage tags for filtering (device_id, alert levels)  
- Store raw values as fields for aggregation
- Include connection health tracking

### Testing External Dependencies  

**MQTT and InfluxDB Mocking:**
- Use Jest's `unstable_mockModule` for ES modules
- Mock external connections but test real parsing logic
- Integration tests verify end-to-end flow
- Create standalone executable script for Docker healthcheck

### Production Deployment

**Performance & Reliability:**
- Batch InfluxDB writes for efficiency
- Implement proper connection recovery  
- Handle partial data gracefully
- Provide meaningful error messages
- Never log sensitive data (passwords, tokens)

### Development Workflow

**Using Subagents Effectively:**
- Leverage specialized agents for focused tasks
- Use general-purpose agents for complex multi-step work
- Break large tasks into manageable chunks
- Minimize context pollution with targeted agent use

### Monitoring and Observability

**Grafana Dashboard Development:**
- Create connected dashboards with navigation links
- Use standard panel types: stat, timeseries, table for consistency
- Implement proper time ranges and refresh intervals
- Provide both overview and detailed views for different use cases

**Alerting Best Practices:**
- Set meaningful thresholds based on operational requirements
- Use appropriate notification channels (existing Telegram setup)
- Implement multi-condition alerts for complex scenarios
- Include proper alert recovery conditions

**GitHub Actions Integration:**
- Follow existing workflow patterns for consistency
- Include Docker Hub authentication for all Docker operations
- Implement comprehensive testing including health checks
- Use version pinning and Dependabot for dependency management