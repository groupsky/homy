# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a comprehensive home automation system built around Docker containers that provides:
- Home Assistant integration for smart home management
- MQTT-based device communication and automation
- Modbus serial communication for various hardware devices
- Time-series data collection with InfluxDB and visualization with Grafana
- Custom automation engine with configurable bots

## Development Commands

### Docker Environment
```bash
# Start the entire system
docker compose up -d

# Start specific services
docker compose up -d broker automations features

# View logs for specific services
docker compose logs -f automations
docker compose logs -f ha

# Rebuild and restart a service
docker compose up -d --build automations
```

**IMPORTANT**: All containers must be built from the `docker/` directory structure. Each service should have its own subdirectory under `docker/` containing its Dockerfile and related files.

**IMPORTANT**: All volume paths in docker-compose.yml should use environment variables: `CONFIG_PATH`, `DATA_PATH`, `SECRETS_PATH`, `BACKUP_PATH`, etc. Avoid hardcoded paths except for system mounts (like `/etc/localtime`, `/dev/bus/usb`, etc.).

## Architecture

### Service Architecture
The system is built around multiple Docker services:

- **broker** (Mosquitto): MQTT message broker for device communication
- **automations**: Custom automation engine that processes MQTT messages
- **features**: Feature state management service
- **ha_discovery**: Home Assistant auto-discovery service
- **ha**: Home Assistant for UI and advanced automations
- **modbus-serial**: Multiple instances for reading different Modbus devices
- **influxdb/grafana**: Time-series data storage and visualization
- **mongo**: Document storage for historical data
- **mqtt-influx**: Multiple bridge services for MQTT to InfluxDB data pipeline

### Service-Specific Documentation

For detailed development guidance, see service-specific CLAUDE.md files:
- `docker/automations/CLAUDE.md` - Bot development, testing patterns
- `docker/mqtt-influx/CLAUDE.md` - Converter development, data types, InfluxDB integration

### Configuration Structure

- `config/automations/`: Bot configurations, feature definitions, Home Assistant integration
- `config/modbus-serial/`: Modbus device configurations for different buses
- `config/grafana/provisioning/`: Grafana dashboards, alerts, and data sources
- Environment variables control service connections and secrets

### Hardware Integration

The system integrates with:
- Multiple Modbus RTU/TCP devices (energy meters, thermostats, I/O modules)
- Arduino Mega for local I/O control
- Various sensors and actuators through custom device drivers
- Solar inverters, irrigation valves, lighting controls

## Documentation

### Architecture
- **System Architecture**: `ARCHITECTURE.md` - Comprehensive architectural overview covering data flow, service architecture, current state, and future direction for planning new features and improvements

### Service Documentation
- **Automation Bots**: `docker/automations/docs/` - Bot-specific guides and implementation details
- **Service Development**: Service-specific CLAUDE.md files provide development patterns and best practices

### Configuration References
- **Main Configuration**: `config/automations/config.js` - Primary system configuration
- **Architecture Overview**: `ARCHITECTURE.md` - Comprehensive system architecture documentation

## File Structure Notes

- Each Docker service has its own directory under `docker/`
- Configuration files are mounted from `config/` directory
- Persistent data is stored in `data/` directory
- Secrets are managed through Docker secrets in `secrets/`
- The `modbus-serial` service has device drivers in `devices/` subdirectory

## Integration Best Practices

### Monitoring Integration
When adding monitoring capabilities:

1. **Use existing infrastructure**: Leverage existing mqtt-influx services and Grafana setup
2. **Follow naming conventions**: Use descriptive service names (e.g., `mqtt-influx-automation`)
3. **Integrate with provisioning**: Place configs in `config/grafana/provisioning/`
4. **Use existing alerting**: Configure alerts with existing Telegram notifiers

### Development Standards
When developing new features:

1. **Service isolation**: Each service has its own directory and CLAUDE.md documentation
2. **Backward compatibility**: Always maintain existing functionality when adding features
3. **Configuration-driven**: Use declarative configuration patterns where possible
4. **Testing**: Write comprehensive tests for all automation logic using minimal mocking to ensure tests verify real system behavior
5. **Documentation standards**: Comments must explain what the code does and why for future maintainers. Avoid preserving development discussions, decision processes, or temporary implementation notes in production code.

### Test-Driven Development (TDD)

**Project-wide TDD Guidelines:**
- Follow Red-Green-Refactor cycle for all new features
- Write tests first to define expected behavior
- Use proper mocking for external dependencies
- Create comprehensive test coverage for critical paths
- Implement integration tests for end-to-end workflows

### Monitoring and Observability

**System-wide Monitoring:**
- Leverage existing mqtt-influx services and Grafana setup for new monitoring needs
- Create connected dashboards with proper navigation and consistent panel types
- Use standard time ranges and refresh intervals across dashboards
- Implement meaningful alerts with proper thresholds and notification channels
- Include both overview and detailed monitoring views

### Configuration and Secrets Management

**Project Standards:**
- Use Docker secrets pattern for all sensitive configuration
- Support both direct environment variables and `_FILE` variants consistently
- Implement early validation with descriptive error messages
- Use meaningful prefixes for environment variables by service type
- Never log sensitive data (passwords, tokens, secrets)

**Environment Variables:**
- **IMPORTANT**: All new environment variables must be added to `example.env` with example values
- Use descriptive names with service prefixes (e.g., `SUNSEEKER_DEVICE_ID`, `MQTT_USERNAME`)
- Include comments explaining the purpose and expected format
- Provide realistic example values that clearly indicate they are examples

**Secrets Management:**
- **IMPORTANT**: When adding new secrets, create example files in the `secrets/` directory
- Use descriptive filenames matching the environment variable pattern
- Example files should contain placeholder values, not real secrets
- Document secret requirements in service-specific CLAUDE.md files

### Documentation Updates
When adding new features that affect architecture:

1. **Update ARCHITECTURE.md**: Add monitoring components to data pipeline services section
2. **Update CLAUDE.md**: Add new MQTT topic patterns and bot capabilities
3. **Create service-specific CLAUDE.md**: For complex services, add local documentation files
4. **Maintain configuration examples**: Provide clear examples for gradual rollout strategies

### Git Workflow
When committing changes:

1. **Selective staging**: Only stage files relevant to the current task. Never stage all untracked files with `git add .` unless all are part of the same logical change
2. **Clean commits**: Avoid including unrelated files, temporary files, or development artifacts in commits