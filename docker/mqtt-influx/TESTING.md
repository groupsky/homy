# MQTT-InfluxDB Service Testing Guide

## Overview

This document describes the comprehensive testing strategy for the mqtt-influx service, implementing minimal mocking principles and multiple testing levels.

## Testing Philosophy

Our testing approach follows these principles:

1. **Minimal Mocking**: Test with real dependencies wherever possible
2. **Behavior Testing**: Focus on what the system does, not how it works internally
3. **Component Isolation**: Test individual components and their integration
4. **Realistic Scenarios**: Use test data that mirrors production workloads

## Test Structure

### 1. Unit Tests (`converters/*.test.js`)

Tests individual converter functions with minimal mocking:

- **Real InfluxDB Client**: Uses actual `@influxdata/influxdb-client` library
- **Line Protocol Testing**: Validates output using `toString()` method
- **Data Transformation**: Verifies MQTT message → InfluxDB Point conversion
- **Edge Cases**: Handles malformed data, unknown types, boundary conditions

**Example:**
```bash
npm run test:converters
npm run test:converter  # Single converter test
```

### 2. MQTT Integration Tests (`mqtt.integration.test.js`)

Tests MQTT connectivity and message routing with Aedes in-memory broker:

- **Real MQTT Protocol**: Uses actual MQTT.js client and Aedes broker
- **Topic Pattern Matching**: Validates wildcard subscriptions (`+`, `#`)
- **Connection Lifecycle**: Tests connect, disconnect, reconnection scenarios
- **Message Delivery**: Verifies QoS, ordering, and payload handling
- **Concurrent Clients**: Multiple service instances and publishers

**Example:**
```bash
npm run test:mqtt
```

### 3. Component Tests (`mqtt-influx.component.test.js`)

Tests complete MQTT → Converter → InfluxDB pipeline:

- **End-to-End Flow**: MQTT message through converter to InfluxDB point
- **Real Dependencies**: Actual MQTT broker + InfluxDB client (mocked writeApi)
- **Multiple Converters**: Tests converter registration and routing
- **Error Handling**: Malformed messages, unknown converters, network errors
- **Topic Routing**: Validates subscription patterns match message routing

**Example:**
```bash
npm run test:component
```

### 4. Service Integration Tests (`service.integration.test.js`)

Tests complete service behavior under realistic conditions:

- **Full Service Simulation**: Mirrors actual `index.js` behavior exactly
- **Environment Configuration**: Tests all environment variables and setup
- **Lifecycle Management**: Startup, operation, graceful shutdown
- **Multiple Event Types**: Mixed converter types in single service instance
- **Error Recovery**: Service resilience and stability under error conditions

**Example:**
```bash
npm run test:integration
```

## Running Tests

### All Tests
```bash
npm test
# or
npm run test:all
```

### Individual Test Suites
```bash
npm run test:converters    # Unit tests for converters
npm run test:mqtt         # MQTT protocol and connectivity
npm run test:component    # MQTT-to-InfluxDB pipeline
npm run test:integration  # Complete service behavior
```

### Watch Mode (Development)
```bash
npm run test:watch
```

## Test Dependencies

### Production Dependencies
- `@influxdata/influxdb-client`: Real InfluxDB client library
- `mqtt`: Real MQTT client library

### Test Dependencies
- `aedes`: In-memory MQTT broker for testing
- `net`: TCP server for Aedes broker
- `node:test`: Node.js native test runner
- `node:assert`: Node.js native assertions

## Testing Scenarios

### Command Verification Events

Tests realistic bath-lights monitoring events:

```javascript
{
  _type: 'command-verification',
  type: 'command_failed',
  controller: 'lightBath1Controller',
  reason: 'toggle_on',
  attempts: 3,
  expectedState: true,
  actualState: false,
  timestamp: Date.now()
}
```

**Published to:** `homy/automation/lightBath1Controller/command_failed`
**Results in:** `command_failure` measurement in InfluxDB

### Energy Meter Events

Tests modbus device data processing:

```javascript
{
  _type: 'dds024mr',
  type: 'energy_reading',
  device: 'device1',
  power: 1500.5,
  voltage: 230.1,
  current: 6.52,
  timestamp: Date.now()
}
```

**Published to:** `modbus/main/device1/reading`
**Results in:** Energy measurements in InfluxDB

## Error Handling Tests

### Malformed Data
- Invalid JSON syntax
- Missing required fields
- Unknown converter types
- Empty messages

### Network Conditions
- MQTT broker disconnection/reconnection
- Connection timeouts
- Message delivery failures
- High throughput scenarios

### Service Resilience
- Burst message processing
- Concurrent client connections
- Resource cleanup and lifecycle management
- Error recovery and continued operation

## Validation Approach

### Line Protocol Testing

Instead of mocking InfluxDB internals, we test the actual line protocol output:

```javascript
const points = converter(inputData)
const lineProtocol = points[0].toString()

assert.match(lineProtocol, /^command_failure,/, 'Measurement name')
assert.match(lineProtocol, /controller=lightBath1Controller/, 'Tag value')
assert.match(lineProtocol, /attempts=3i/, 'Integer field')
```

### Message Flow Validation

We test the complete message flow using real MQTT communication:

1. Publish message to MQTT broker
2. Service receives and processes message
3. Converter transforms data
4. InfluxDB point is generated
5. Validate point structure and content

### Behavior Verification

Tests focus on observable behavior rather than implementation details:

- **What data is produced** (not how it's generated)
- **Which topics are subscribed to** (not internal routing logic)
- **How errors are handled** (not specific error handling code)
- **Resource cleanup behavior** (not internal cleanup mechanisms)

## Performance Considerations

### Test Isolation

Each test runs with:
- Fresh MQTT broker instance
- Clean test data sets
- Isolated port numbers
- Independent service instances

### Resource Management

Tests automatically:
- Start and stop MQTT brokers
- Clean up connections and clients
- Reset captured data between tests
- Handle concurrent access to resources

### Timing Controls

Configurable timeouts for:
- Service startup: 5 seconds
- Message processing: 1 second
- Connection establishment: 3 seconds
- Graceful shutdown: 3 seconds

## Debugging Tests

### Verbose Output

Most tests include console logging for debugging:

```bash
npm run test:component  # See detailed test execution logs
```

### Test Data Inspection

Captured InfluxDB points can be inspected:

```javascript
console.log('Generated line protocol:', capturedPoints[0].toString())
```

### Broker Event Monitoring

MQTT broker events are logged during tests:

```javascript
aedesBroker.on('client', (client) => {
  console.log(`Client ${client.id} connected`)
})
```

## Integration with CI/CD

### Automated Testing

Tests run automatically in CI environments:

```bash
CI=true npm test  # Enables headless mode where applicable
```

### Resource Requirements

- Memory: ~100MB for concurrent test execution
- Network: Local TCP ports 1884-1886 for test brokers
- Dependencies: Node.js 18+ for native test runner and fetch API

### Test Reliability

- **Deterministic**: Tests use fixed data and controlled timing
- **Isolated**: No shared state between test runs
- **Idempotent**: Can be run multiple times with same results
- **Fast**: Complete test suite runs in under 30 seconds

## Future Enhancements

### Potential Additions

1. **Performance Testing**: Load testing with high message volumes
2. **Failover Testing**: Broker restart and service recovery scenarios
3. **Security Testing**: Authentication and authorization scenarios
4. **Memory Testing**: Long-running tests to detect memory leaks
5. **Real InfluxDB Integration**: Optional tests with actual InfluxDB instance

### Test Data Expansion

- Additional converter types (ex9em, sdm630, or-we-514)
- Complex topic patterns and edge cases
- Large message payloads and stress testing
- Time-series data patterns and ordering

### Monitoring Integration

- Test execution metrics
- Test result dashboards
- Performance regression detection
- Automated test reporting