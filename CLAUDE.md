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

### Backup and Restore

**Create Backup:**
```bash
./scripts/backup.sh                    # Auto-timestamped backup
./scripts/backup.sh -s -y              # Stop services first (recommended)
./scripts/backup.sh my-backup-name     # Named backup
```

**Restore from Backup:**
```bash
./scripts/restore.sh <backup-name>     # Must have services stopped
```

**Covered Volumes:**
- Home Assistant (config, entity registry, history)
- MongoDB (historical device data)
- InfluxDB (time-series sensor data)
- Grafana (dashboards, alerts, users)
- Zigbee2MQTT (device database, network state)
- WireGuard VPN (peer configurations)
- Automation service state (bot memory)

For detailed documentation, see `docker/volman/CLAUDE.md`.

### Deployment Scripts Testing

Deployment scripts (`backup.sh`, `restore.sh`, `deploy.sh`, `rollback.sh`) have comprehensive BATS (Bash Automated Testing System) test coverage to ensure reliability and prevent regressions.

**Run All Tests:**
```bash
cd scripts/tests
./bats-core/bin/bats *.bats
```

**Run Specific Test File:**
```bash
cd scripts/tests
./bats-core/bin/bats docker-helper.bats  # Test helper functions
./bats-core/bin/bats backup.bats         # Test backup operations
./bats-core/bin/bats restore.bats        # Test restore operations
```

**Test Coverage:**
- 60+ comprehensive tests
- Version detection (docker compose v1 vs v2)
- Input validation and security (path traversal prevention)
- Logging and error handling
- Atomic file operations
- Backup/restore workflows

**CI Integration:**
- Tests run automatically on all PRs modifying `scripts/`
- Bash syntax validation with shellcheck
- No Docker required (fully mocked for fast execution)

For detailed testing documentation, see `scripts/tests/README.md`.

**IMPORTANT**: All containers must be built from the `docker/` directory structure. Each service should have its own subdirectory under `docker/` containing its Dockerfile and related files.

**IMPORTANT**: All volume paths in docker-compose.yml should use environment variables: `CONFIG_PATH`, `DATA_PATH`, `SECRETS_PATH`, `BACKUP_PATH`, etc. Avoid hardcoded paths except for system mounts (like `/etc/localtime`, `/dev/bus/usb`, etc.).

### Docker Base Images - GHCR-Only Policy

**CRITICAL RULE**: All Docker services MUST use base images from `ghcr.io/groupsky/homy/*` exclusively. Direct pulls from Docker Hub are **PROHIBITED**.

**Why:**
- Eliminates Docker Hub rate limits (200 pulls/6h) that cause CI failures
- Enables two-step dependency upgrade workflow with Renovate
- Provides centralized control over base image versions

**Usage:**
```dockerfile
# ✅ CORRECT - Use GHCR base images
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine
FROM ghcr.io/groupsky/homy/grafana:9.5.21

# ❌ WRONG - Direct Docker Hub pulls are blocked
FROM node:18.20.8-alpine
FROM grafana/grafana:9.5.21
```

**Enforcement:**
- `.github/workflows/validate-docker-dependencies.yml` enforces this policy on all PRs
- Any Dockerfile using non-GHCR images (except `ghcr.io/home-assistant/*`) will fail CI

**Available Base Images:**
See `base-images/README.md` for complete list. Common images:
- `ghcr.io/groupsky/homy/node:18.20.8-alpine`, `node:22-alpine`
- `ghcr.io/groupsky/homy/grafana:*`, `influxdb:*`, `mosquitto:*`
- `ghcr.io/groupsky/homy/alpine:*`, `nginx:*`, `ubuntu:*`

**Adding New Base Images:**
See `base-images/CLAUDE.md` for detailed instructions on creating new base images.

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
- `docker/zigbee2mqtt/CLAUDE.md` - Zigbee device integration, multi-instance setup, network coordinator configuration

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

### System Specifications
- **Infrastructure Documentation**: `docs/CLAUDE.md` - System-level specifications and technical documentation index
- **InfluxDB Schema**: `docs/influxdb-schema.md` - Comprehensive documentation of time-series database structure and data sources

### Service Documentation
- **Automation Bots**: `docker/automations/docs/` - Bot-specific guides and implementation details
- **Service Development**: Service-specific CLAUDE.md files provide development patterns and best practices

### CI/CD and Infrastructure
- **Unified CI Pipeline**: `.github/workflows/CLAUDE.md` - Complete guide to the 6-stage Docker build pipeline with artifact-based security, test-gated promotion, and troubleshooting
- **Base Images**: `base-images/CLAUDE.md` - Base image management, Renovate workflow, and GHCR 503 handling

**Workflow Execution Strategy** (Migration Complete):

All Docker image builds and tests now use the unified CI/CD pipeline (`ci-unified.yml`). Previous fragmented workflows have been disabled or converted to scheduled execution:

- **Application CI/CD**: Use `ci-unified.yml` for all service builds, tests, and deployments
  - Automatically triggered on push/PR when Docker-related files change
  - 7-stage pipeline: detect → prepare bases → build apps → pull for testing → test (4 parallel jobs) → push → summary
  - Test-gated promotion ensures only passing builds get `:latest` tag
  - **Test-only optimization**: Services with only test file changes pull existing images instead of rebuilding (50-60% faster)

- **Infrastructure Validation**: `infrastructure.yml` runs on path-filtered changes + weekly schedule
  - Validates nginx config generation, proxy routing, ingress configuration
  - 86% CI quota savings compared to running on every commit

- **Network Security**: `routing.yml` runs on weekly schedule only (Monday 3 AM UTC)
  - VPN/routing layer validation, infrastructure focus

**Disabled Workflows (8 total)**: The following workflows have been renamed to `.disabled` and replaced by ci-unified.yml:
- `base-images.yml`, `app-images.yml` (image building)
- `automations-tests.yml`, `modbus-serial-tests.yml`, `telegram-bridge-tests.yml`, `automation-events-processor-tests.yml`, `sunseeker-monitoring-tests.yml` (service tests)
- `lights-test.yml` (integration testing)

See `.github/workflows/CLAUDE.md` for complete migration details and troubleshooting guide.

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

### Language Preference Policy

**CRITICAL**: When creating new code, follow this priority order:

1. **JavaScript/TypeScript** - For complex logic, API integrations, parsing, data transformations
2. **Bash** - For simple scripts, file operations, basic automation
3. **Go** - For performance-critical services, system-level tools
4. **Other languages** - Only when specific library/ecosystem requirements mandate it

**Rationale:**
- JavaScript/TypeScript aligns with the majority of services (automations, mqtt-influx, etc.)
- Enables code reuse and shared utilities across services
- Better tooling and IDE support for the existing codebase
- Bash keeps simple tasks simple without unnecessary complexity
- Go for when performance truly matters

**Examples:**
- ✅ CI/CD orchestration scripts → **TypeScript**
- ✅ Dockerfile parsing and validation → **TypeScript**
- ✅ Git hooks and simple file operations → **Bash**
- ✅ High-throughput data processing → **Go**
- ⚠️ Python/other → Only when required library unavailable in preferred languages

### Test-Driven Development (TDD)

**Project-wide TDD Guidelines:**
- Follow Red-Green-Refactor cycle for all new features
- Write tests first to define expected behavior
- Use proper mocking for external dependencies
- Create comprehensive test coverage for critical paths
- Implement integration tests for end-to-end workflows

**CI Optimization for Test Development:**
- The CI pipeline automatically detects test-only changes (test files, test configs, devDependencies)
- Test-only changes trigger fast CI runs by pulling existing images instead of rebuilding (~50-60% faster)
- This encourages frequent test improvements without CI performance penalties
- Recognized test patterns: `*.test.{js,ts}`, `*.spec.{js,ts}`, `__tests__/`, `jest.config.js`

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
5. **Avoid link duplication**: Reference detailed documentation from the most relevant service-specific CLAUDE.md files rather than duplicating links in multiple locations. Use `docs/CLAUDE.md` as the central documentation index.
6. **Strategic cross-referencing**: Add cross-references to system documentation only in service-specific CLAUDE.md files where developers would actually need that information (e.g., water system specs in automations, grafana, and mqtt-influx CLAUDE.md files, but not in unrelated services).

### InfluxDB Schema Updates
**CRITICAL**: When modifying any service that writes to InfluxDB:

1. **Update [InfluxDB Schema Documentation](docs/influxdb-schema.md)** - Document all measurement, field, and tag changes
2. **Test downstream consumers** - Verify Grafana dashboards and Home Assistant entities
3. **Plan data continuity** - Consider impact on historical data and queries
4. **Coordinate with team** - InfluxDB changes affect multiple services and dashboards

**Services writing to InfluxDB:**
- `modbus-serial` - Direct writes (energy, temperature, control data)
- `mqtt-influx` - MQTT message conversion
- `sunseeker-monitoring` - Specialized monitoring with own mqtt-influx integration

### Git Workflow
When committing changes:

1. **Selective staging**: Only stage files relevant to the current task. Never stage all untracked files with `git add .` unless all are part of the same logical change
2. **Clean commits**: Avoid including unrelated files, temporary files, or development artifacts in commits