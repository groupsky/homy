# CLAUDE.md - MQTT-InfluxDB Sunseeker Service

This service bridges MQTT messages from Sunseeker lawn mower devices to InfluxDB for monitoring and analytics.

## Service Overview

This Node.js service:
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
  device_id: '22031680002700015651',
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

### External Dependencies Testing

**MQTT and InfluxDB Mocking:**
- Use Jest's `unstable_mockModule` for ES modules
- Mock external connections but test real parsing logic
- Integration tests verify end-to-end flow without external dependencies
- Create standalone executable health check script for Docker

**Mock Patterns:**
```javascript
// Mock MQTT client
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
docker compose build mqtt-influx-sunseeker

# Run service with logs
docker compose up mqtt-influx-sunseeker

# Health check
docker compose exec mqtt-influx-sunseeker node health-check.js

# View service logs
docker compose logs -f mqtt-influx-sunseeker
```

## Monitoring

The service integrates with existing Grafana dashboards:
- **sunseeker-overview.json** - Current status and battery level
- **sunseeker-battery.json** - Detailed battery health monitoring

Alerts are configured for:
- Battery level below 15%
- Temperature above 45°C or below 5°C
- Connection loss (no messages for 30 minutes)