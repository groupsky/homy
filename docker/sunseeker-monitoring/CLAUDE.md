# CLAUDE.md - Sunseeker Monitoring Service

This service provides comprehensive monitoring for Sunseeker lawn mower devices by bridging MQTT messages to InfluxDB for data collection, analysis, and alerting.

## Service Overview

The Sunseeker monitoring service:
- Connects to external MQTT broker at `mqtts.sk-robot.com`
- Parses Sunseeker-specific message formats
- Stores structured data in InfluxDB with appropriate measurements and tags
- Provides health monitoring and metrics collection

## Development Patterns

### Test-Driven Development (TDD)

**Test-First Approach:**
1. **Write Tests First**: Create comprehensive Jest tests before implementation
   - Message parser tests defining expected behavior for all command types
   - Integration tests for MQTT-InfluxDB data flow
   - Health check tests for Docker monitoring

2. **Red-Green-Refactor Cycle**: 
   - **Red**: Tests fail initially (expected)
   - **Green**: Implement minimal code to pass tests
   - **Refactor**: Extract constants, utilities, improve structure

**Test Structure:**
```javascript
// Unit tests for each command type
describe('cmd 501 status updates', () => {
  it('should parse mode, power, station data', () => {
    // Test implementation
  });
});

// Integration tests for end-to-end flow
describe('MQTT to InfluxDB integration', () => {
  it('should process messages and write to InfluxDB', () => {
    // Mock external connections, test real logic
  });
});
```

### Code Organization

**Modular Structure:**
- `message-parser.js` - Core parsing logic for Sunseeker messages
- `mqtt-influx-service.js` - Main service class with MQTT and InfluxDB integration
- `constants.js` - All magic numbers, strings, and configuration constants
- `utils.js` - Common utilities (Docker secrets, validation, helpers)
- `logger.js` - Standardized logging with emoji prefixes
- `config.js` - Configuration loading and validation
- `health-check.js` - Standalone Docker health check script

**Constants Extraction:**
```javascript
// Extract all magic values to constants.js
export const SUNSEEKER_MODES = {
  0: 'Standby',
  1: 'Mowing', 
  2: 'Going Home',
  3: 'Charging'
};

export const TEMPERATURE = {
  HIGH_THRESHOLD: 40,
  LOW_THRESHOLD: 10,
  ALERTS: {
    HIGH: 'high',
    LOW: 'low',
    NORMAL: 'normal'
  }
};
```

### Configuration Management

**Docker Secrets Pattern:**
```javascript
// Support both direct env vars and _FILE variants
export function loadSecret(name) {
  const fileEnvVar = `${name}_FILE`;
  const directEnvVar = name;
  
  if (process.env[fileEnvVar]) {
    return fs.readFileSync(process.env[fileEnvVar], 'utf8').trim();
  } else if (process.env[directEnvVar]) {
    return process.env[directEnvVar];
  }
  
  return null;
}
```

**Configuration Validation:**
- Validate all required fields early with clear error messages
- Use descriptive prefixes: `MQTT_`, `INFLUX_` for clarity
- Provide meaningful defaults where appropriate

### Message Parsing

**Command Type Handling:**
- **cmd 501**: Status updates (mode, power, station)
- **cmd 509**: Log messages with battery details
- **cmd 511**: State change messages
- **cmd 512**: Battery info (charge/discharge cycles)
- **cmd 400**: Command acknowledgments

**Log Data Extraction:**
Use regex patterns to extract structured data from log text:
```javascript
const volMatch = logText.match(/bat vol=(\d+)(?:mV)?/);
const tempMatch = logText.match(/temp=(\d+)/);
const percentMatch = logText.match(/percent=(\d+)/);
```

### InfluxDB Data Modeling

**Measurement Structure:**
- `sunseeker_mode` - Operating mode changes
- `sunseeker_power` - Battery percentage data
- `sunseeker_station` - Docking station status
- `sunseeker_battery_detail` - Detailed battery metrics from logs
- `sunseeker_connection` - Connection health tracking
- `sunseeker_commands` - Command acknowledgments
- `sunseeker_state_change` - State change events

**Tags vs Fields:**
- **Tags**: Use for filtering (device_id, alert levels)
- **Fields**: Store raw values for aggregation (voltage, temperature, percentage)

**Data Point Structure:**
```javascript
{
  measurement: 'sunseeker_battery_detail',
  device_id: 'EXAMPLE_DEVICE_ID',
  fields: {
    voltage_mv: 20182,
    temperature: 24,
    percentage: 94
  },
  tags: {
    temp_alert: 'normal'
  },
  timestamp: new Date()
}
```

### Integration Testing with Testcontainers

**IMPORTANT RULE**: All service integration tests MUST use Testcontainers for external dependencies (MQTT, InfluxDB, databases). This ensures tests run against real services while maintaining isolation and reproducibility.

**Installation:**
```bash
npm install testcontainers --save-dev
```

**MQTT Container Setup:**
```javascript
const { GenericContainer, Wait } = require('testcontainers');
const mqtt = require('mqtt');

describe('MQTT Integration Tests', () => {
  let mosquittoContainer;
  let mqttClient;

  beforeAll(async () => {
    mosquittoContainer = await new GenericContainer('eclipse-mosquitto:2.0')
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage('mosquitto version'))
      .withNetworkAliases('mqtt-broker')
      .start();

    const mqttUrl = `mqtt://${mosquittoContainer.getHost()}:${mosquittoContainer.getMappedPort(1883)}`;
    mqttClient = mqtt.connect(mqttUrl);
  });

  afterAll(async () => {
    if (mqttClient) await mqttClient.endAsync();
    if (mosquittoContainer) await mosquittoContainer.stop();
  });
});
```

**InfluxDB Container Setup:**
```javascript
const { GenericContainer, Wait } = require('testcontainers');
const { InfluxDB } = require('@influxdata/influxdb-client');

describe('InfluxDB Integration Tests', () => {
  let influxContainer;
  let influxClient;

  beforeAll(async () => {
    influxContainer = await new GenericContainer('influxdb:2.7')
      .withExposedPorts(8086)
      .withEnvironment({
        DOCKER_INFLUXDB_INIT_MODE: 'setup',
        DOCKER_INFLUXDB_INIT_USERNAME: 'test-user',
        DOCKER_INFLUXDB_INIT_PASSWORD: 'test-password',
        DOCKER_INFLUXDB_INIT_ORG: 'test-org',
        DOCKER_INFLUXDB_INIT_BUCKET: 'test-bucket',
        DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: 'test-token'
      })
      .withWaitStrategy(Wait.forHttps(8086, '/health'))
      .start();

    const url = `http://${influxContainer.getHost()}:${influxContainer.getMappedPort(8086)}`;
    influxClient = new InfluxDB({ url, token: 'test-token' });
  });

  afterAll(async () => {
    if (influxContainer) await influxContainer.stop();
  });
});
```

**Full Service Integration Test:**
```javascript
const { GenericContainer, Network, Wait } = require('testcontainers');

describe('Sunseeker MQTT-InfluxDB Bridge Integration', () => {
  let network;
  let mosquittoContainer;
  let influxContainer;

  beforeAll(async () => {
    // Create dedicated network for container communication
    network = await new Network().start();

    // Start MQTT broker
    mosquittoContainer = await new GenericContainer('eclipse-mosquitto:2.0')
      .withNetwork(network)
      .withNetworkAliases('mqtt-broker')
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage('mosquitto version'))
      .start();

    // Start InfluxDB
    influxContainer = await new GenericContainer('influxdb:2.7')
      .withNetwork(network)
      .withNetworkAliases('influxdb')
      .withExposedPorts(8086)
      .withEnvironment({
        DOCKER_INFLUXDB_INIT_MODE: 'setup',
        DOCKER_INFLUXDB_INIT_USERNAME: 'admin',
        DOCKER_INFLUXDB_INIT_PASSWORD: 'password',
        DOCKER_INFLUXDB_INIT_ORG: 'test-org',
        DOCKER_INFLUXDB_INIT_BUCKET: 'test-bucket',
        DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: 'test-token'
      })
      .withWaitStrategy(Wait.forHttps(8086, '/health'))
      .start();
  });

  afterAll(async () => {
    await Promise.all([
      influxContainer?.stop(),
      mosquittoContainer?.stop(),
      network?.stop()
    ]);
  });

  test('should bridge Sunseeker MQTT messages to InfluxDB', async () => {
    // Test implementation that publishes real MQTT messages
    // and verifies data is written to InfluxDB
  });
});
```

**Jest Configuration for Testcontainers:**
```javascript
// jest.config.js
module.exports = {
  testTimeout: 60000, // Increased timeout for container operations
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  detectOpenHandles: true,
  maxConcurrency: 4, // Limit parallel tests to avoid resource contention
};
```

**Testcontainers Best Practices:**

1. **Container Reuse**: Enable `TESTCONTAINERS_REUSE_ENABLE=true` for faster test runs
2. **Resource Management**: Set memory and CPU limits to prevent resource exhaustion
3. **Network Isolation**: Use dedicated networks for multi-container tests
4. **Cleanup Strategy**: Containers auto-cleanup via Ryuk, manual cleanup for shared resources
5. **CI/CD Integration**: Ensure Docker is available in CI pipeline, consider resource limits

**Environment Variables for Testing:**
```javascript
const testContainer = await new GenericContainer('sunseeker-monitoring:latest')
  .withNetwork(network)
  .withEnvironment({
    NODE_ENV: 'test',
    MQTT_BROKER_URL: 'mqtt://mqtt-broker:1883',
    INFLUXDB_URL: 'http://influxdb:8086',
    INFLUXDB_TOKEN: 'test-token',
    INFLUXDB_ORG: 'test-org',
    INFLUXDB_BUCKET: 'test-bucket'
  })
  .withWaitStrategy(Wait.forLogMessage('Service ready'))
  .start();
```

**Unit Testing with Mocks (for isolated logic):**
Use mocks only for unit tests of parsing logic and utilities:
```javascript
// Mock MQTT client for unit tests
const mockMqttClient = {
  connect: jest.fn(),
  on: jest.fn(),
  subscribe: jest.fn(),
  end: jest.fn()
};
```

### Error Handling and Logging

**Standardized Logging:**
```javascript
// Emoji-prefixed logging for easy identification
logger.connection('Connected to MQTT broker');
logger.message('Received message on topic');
logger.write('Wrote 3 points to InfluxDB');
logger.error('Failed to parse message', error);
```

**Error Context:**
```javascript
export function createError(message, context, originalError = null) {
  const error = new Error(message);
  error.context = context;
  error.originalError = originalError;
  return error;
}
```

### Performance and Reliability

**Best Practices:**
- Batch InfluxDB writes for efficiency
- Implement proper MQTT connection recovery
- Handle partial data gracefully (missing fields)
- Provide meaningful error messages
- Never log sensitive data (passwords, tokens)
- Use connection health tracking for monitoring

**Health Monitoring:**
- Implement `isHealthy()` method checking recent activity
- Provide metrics: messages processed, points written, uptime
- Create standalone health check script for Docker

### Service Integration

**Docker Compose:**
- Use existing network patterns (automation, egress)
- Leverage existing secrets (influxdb_write_user)
- Maintain security with `no-new-privileges:true`
- Add service-specific secrets only when necessary

**Environment Variables:**
```bash
MQTT_URL=mqtts://mqtts.sk-robot.com:8883
MQTT_USERNAME=app
MQTT_PASSWORD_FILE=/run/secrets/sunseeker_mqtt_password
MQTT_DEVICE_ID=${SUNSEEKER_DEVICE_ID}
MQTT_APP_ID=${SUNSEEKER_APP_ID}
```

## Testing Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Check types (if using TypeScript)
npm run type-check
```

## Docker Operations

```bash
# Build service
docker compose build sunseeker-monitoring

# Run service with logs
docker compose up sunseeker-monitoring

# Health check
docker compose exec sunseeker-monitoring node health-check.js

# View service logs
docker compose logs -f sunseeker-monitoring
```

## Monitoring

The service integrates with existing Grafana dashboards:
- **sunseeker-overview.json** - Current status and battery level
- **sunseeker-battery.json** - Detailed battery health monitoring

Alerts are configured for:
- Battery level below 15%
- Temperature above 45°C or below 5°C
- Connection loss (no messages for 30 minutes)