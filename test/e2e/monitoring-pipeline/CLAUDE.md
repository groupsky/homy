# CLAUDE.md - Monitoring Pipeline E2E Test

This directory contains the end-to-end test for the bath-lights monitoring and alerting pipeline.

## Overview

This E2E test validates the complete monitoring flow from bath-lights command failures through to Grafana dashboard visualization and alert functionality.

### Test Coverage

The test validates:
- **MQTT Event Publishing** - Bath-lights failure events are published correctly
- **Data Pipeline Processing** - mqtt-influx-automation service processes events
- **InfluxDB Storage** - Events are stored with correct structure and data
- **Grafana Integration** - Data sources, queries, and dashboard functionality
- **API Accessibility** - All monitoring APIs are functional
- **Error Handling** - Edge cases and malformed data handling

## Architecture

### Test Pipeline Flow
```
Test Data → MQTT Client → mqtt-influx-automation → InfluxDB → Grafana API → Playwright UI → Validation
```

### Components

#### Core Test File
- `monitoring-pipeline.e2e.test.js` - Main test implementation using Node.js test runner

#### Test Utilities (`lib/`)
- `mqtt-client.js` - MQTT connection, event publishing, and lifecycle management
- `influx-client.js` - InfluxDB querying, data validation, and health checks
- `grafana-client.js` - Grafana API testing, query validation, and health monitoring

#### Infrastructure
- `package.json` - Test dependencies and execution scripts
- `docker-compose.test.yml` - Test service overlay for Docker Compose
- `run-test.sh` - Complete test orchestration and environment management

## Running the Test

### Quick Start
```bash
cd test/e2e/monitoring-pipeline
./setup-test-secrets.sh  # First time setup
./run-test.sh
```

### Manual Steps
```bash
# Setup test secrets (first time only)
./setup-test-secrets.sh

# Install dependencies
npm install

# Start environment (from repository root)
docker compose --env-file test/e2e/monitoring-pipeline/.env.test -f docker-compose.yml -f test/e2e/monitoring-pipeline/docker-compose.test.yml up -d

# Wait for services, then run test
npm test

# Cleanup
docker compose --env-file test/e2e/monitoring-pipeline/.env.test -f docker-compose.yml -f test/e2e/monitoring-pipeline/docker-compose.test.yml down
```

### CI/CD Mode
```bash
CI=true ./run-test.sh  # Runs headless browser
```

## Test Data

### Failure Events
The test publishes realistic failure events:
```javascript
{
  controller: 'lightBath1Controller',
  reason: 'toggle_on',
  attempts: 3,
  expectedState: true,
  actualState: false
}
```

### Validation Points
- MQTT message format and schema
- InfluxDB point structure (measurements, tags, fields)
- Grafana query compatibility
- API response formats
- Dashboard accessibility

## Dependencies

### Node.js Packages
- `mqtt@^5.3.4` - MQTT client for event publishing
- `@influxdata/influxdb-client@^1.33.2` - InfluxDB queries and validation
- `playwright@^1.40.1` - Browser automation for Grafana UI testing

### System Requirements
- Docker and Docker Compose
- Node.js 18+ (for native test runner and fetch API)
- Available ports: 1883 (MQTT), 8086 (InfluxDB), 3000 (Grafana)

## Configuration

### Security and Isolation

**IMPORTANT**: This test environment is completely isolated from production:
- Uses separate Docker Compose project (`homy-monitoring-e2e`)
- All services use internal Docker networking (no external ports)
- Uses dedicated test secrets from `secrets.test/` directory via `.env.test`
- No connection to production services at 192.168.13.2
- Telegram notifications use local test bot credentials

### Environment Variables
```bash
BROKER=mqtt://broker:1883              # Internal MQTT broker (NOT production)
INFLUXDB_URL=http://influxdb:8086      # Internal InfluxDB (NOT production)
GRAFANA_URL=http://grafana:3000        # Internal Grafana (NOT production)
INFLUXDB_DATABASE=homy                 # Test database name
CI=true                                # Enable headless mode
```

### Test Environment Configuration

The test uses a dedicated `.env.test` file that overrides the secrets path:
```bash
SECRETS_PATH=./secrets.test
COMPOSE_PROJECT_NAME=homy-monitoring-e2e
```

This directs Docker Compose to use test secrets from `secrets.test/` instead of production `secrets/`:
- `telegram_bot_token` - Local test bot token (copied from `secrets.local/`)
- `telegram_chat_id` - Local test chat ID (copied from `secrets.local/`)
- `influxdb_read_user` and `influxdb_read_user_password` - Test InfluxDB credentials

These are completely separate from production credentials and prevent accidental use of production Telegram bots or services.

### Timeouts
- Service readiness: 60 seconds
- Data processing: 10 seconds  
- Query execution: 5 seconds

## Test Scenarios

### Primary Test: Complete Pipeline Validation
1. **Setup Phase** - Wait for all services to be ready
2. **Event Publishing** - Publish failure events via MQTT
3. **Data Processing** - Wait for mqtt-influx-automation processing
4. **Storage Validation** - Query InfluxDB and validate data structure
5. **Grafana Testing** - Test data sources, queries, and UI accessibility
6. **API Validation** - Verify all monitoring APIs are functional

### Secondary Test: Edge Cases
- Empty event arrays
- Malformed event data
- Non-existent measurement queries
- Service error conditions

## Troubleshooting

### Common Issues

#### Services Not Ready
```bash
# Check service status
docker compose ps

# View service logs
docker compose logs mqtt-influx-automation
docker compose logs influxdb
docker compose logs grafana
```

#### Test Timeouts
```bash
# Increase timeout for slower systems
TIMEOUT=300 ./run-test.sh
```

#### Connection Errors
```bash
# Verify port availability
netstat -tulpn | grep -E '(1883|8086|3000)'

# Check Docker network
docker network ls
docker network inspect homy_automation
```

#### Browser Issues
```bash
# Run in headless mode
CI=true npm test

# Install Playwright browsers
npx playwright install
```

### Service Health Checks

#### MQTT Broker
```bash
docker compose exec broker mosquitto_pub -t test -m "health"
```

#### InfluxDB
```bash
curl -s http://localhost:8086/ping
```

#### Grafana
```bash
curl -s http://localhost:3000/api/health
```

## Development

### Adding New Test Cases
1. Create test data in `monitoring-pipeline.e2e.test.js`
2. Add validation logic using existing utilities
3. Update documentation with new scenarios

### Extending Utilities
- **mqtt-client.js** - Add new event types or connection patterns
- **influx-client.js** - Add new query patterns or validation logic
- **grafana-client.js** - Add new API endpoints or dashboard tests

### Testing Locally
```bash
# Run with verbose output
npm run test:verbose

# Run with debug logging
DEBUG=* npm test
```

## Integration with CI/CD

### Pipeline Integration
```yaml
# Example GitHub Actions step
- name: Run monitoring E2E test
  run: |
    cd test/e2e/monitoring-pipeline
    CI=true ./run-test.sh
```

### Docker Resources
The test requires significant Docker resources:
- ~8 containers running simultaneously
- Network communication between services
- Persistent volume management

### Performance Considerations
- Test duration: ~2-3 minutes (including service startup)
- Resource usage: ~2GB RAM, moderate CPU
- Network: Local Docker networking only

## Future Enhancements

### Potential Additions
- **Alert Rule Testing** - Validate Grafana alert evaluation logic
- **Telegram Integration** - Test actual notification delivery
- **Load Testing** - High-throughput failure event scenarios
- **Dashboard Screenshots** - Visual regression testing
- **Metrics Validation** - Detailed mathematical validation of aggregations

### Monitoring Integration
- **Test Results Dashboard** - Grafana dashboard for test metrics
- **Performance Tracking** - Monitor test execution time and reliability
- **Failure Analysis** - Automated analysis of test failures
