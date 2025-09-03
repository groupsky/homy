# CLAUDE.md - Automations Service

This file provides guidance specific to the automations service for Claude Code.

## Quick Commands from Main Directory

### Testing
```bash
# Run tests for the automations service
cd docker/automations
npm test

# Run individual test files
npx jest bots/irrigation.test.js
```

### Automation Development
```bash
# Test automation configurations
cd docker/automations
node index.js  # Uses CONFIG env var or ./config file
```

## Service Overview

The automations service is the core automation engine that processes MQTT messages and executes intelligent home automation logic. It consists of configurable "bots" that implement various automation patterns.

## Development Workflow

### Local Testing
```bash
# Run tests
npm test

# Run specific test files
npx jest bots/bath-lights.test.js

# Test with coverage
npm run test:coverage

# Run with watch mode during development
npx jest --watch
```

### Configuration Testing
```bash
# Test automation configuration without running full system
node index.js

# Test with specific config file
CONFIG=/path/to/test-config.js node index.js
```

## Bot Development Patterns

### Bot Structure
Each bot follows this standard pattern:
```javascript
module.exports = (name, config) => ({
    start: ({mqtt}) => {
        // Initialization logic
        
        // Subscribe to MQTT topics
        mqtt.subscribe(config.inputTopic, (payload) => {
            // Process input and trigger outputs
            mqtt.publish(config.outputTopic, result)
        })
    }
})
```

### Architecture Integration

The core automation logic is built around:

- **Bots**: Individual automation units defined in configuration files
- **Features**: Abstracted device states (lights, switches, sensors)
- **Functions**: Reusable transformation utilities in `funcs/`
- **Resolver**: Dynamic module loading system (`lib/resolve.js`)

Key patterns:
- Bots are configured declaratively and loaded dynamically
- MQTT topics follow structured patterns like `/modbus/{bus}/{device}/{action}`
- Feature states are managed through `homy/features/{type}/{name}/{action}` topics
- Time-based automations use cron expressions and solar calculations

### Configuration Structure

- `config/automations/config.js`: Main automation bot configurations
- `config/automations/features.js`: Feature definitions and mappings
- `config/automations/ha_discovery.js`: Home Assistant integration setup

### Common Bot Types

#### `feature-toggle-on-feature-change` - Input/output mapping
- **Purpose**: Direct mapping of input changes to output toggles with debouncing
- **Use Cases**: Light switches, relay controls, button mappings

#### `bath-lights` - Occupancy-based lighting
- **Purpose**: Bathroom lighting automation with timeout logic
- **Features**: Door/lock sensors, toggle switches, multiple timeout scenarios
- **Configuration**:
  ```javascript
  {
    type: 'bath-lights',
    door: {statusTopic: 'homy/features/open/bath1_door_open/status'},
    lock: {statusTopic: 'homy/features/lock/bath1_door_lock/status'},
    light: {
      commandTopic: 'homy/features/light/bath1_ceiling_light/set',
      statusTopic: 'homy/features/light/bath1_ceiling_light/status'
    },
    toggle: {type: 'button', statusTopic: 'homy/features/button/bath1_switch_left/status'},
    timeouts: {closed: 120000, opened: 720000, toggled: 1500000, unlocked: 180000},
  }
  ```

#### `feature-toggle-on-feature-change` - Input/output mapping
- **Purpose**: Direct mapping of input changes to output toggles with debouncing
- **Use Cases**: Light switches, relay controls, button mappings

#### `irrigation` - Scheduled watering systems
- **Purpose**: Cron-based irrigation with safety timeouts
- **Features**: Schedule expressions, safety shutoffs, weather integration
- **System Reference**: See `docs/water_system_spec.md` for complete irrigation circuit specifications

#### `bac002-*` - HVAC thermostat control
- **Purpose**: BACnet thermostat synchronization and control
- **Features**: Clock sync, power management based on door/window states

## Testing Guidelines

### Test Structure
- Use Jest testing framework with fake timers for timeout testing
- Create comprehensive test coverage for all bot scenarios

### Mock MQTT Infrastructure
```javascript
const mqttSubscriptions = {}
const publish = (topic, payload) => {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic](payload)
    }
}
const subscribe = (topic, callback) => {
    mqttSubscriptions[topic] = callback
}
```

### Critical Test Scenarios
- **State transitions**: Test all input combinations and expected outputs
- **Timeout behavior**: Verify timeout logic with jest.advanceTimersByTime()
- **Edge cases**: Null payloads, rapid state changes, concurrent commands
- **Backward compatibility**: Ensure existing configurations continue working

## Integration Patterns

### MQTT Topic Conventions
- **Input topics**: Listen to feature status topics and modbus readings
- **Output topics**: Publish to feature command topics and automation events
- **Monitoring topics**: Publish failure events to `homy/automation/{name}/command_failed`
- **Water System Topics**: See `docs/water_system_spec.md` for complete MQTT topic mappings for pumps, sensors, and controls

### Feature Integration
- Use the features service for device abstraction
- Subscribe to `homy/features/{type}/{name}/status` for device states
- Publish to `homy/features/{type}/{name}/set` for device commands

### Configuration Management
- Configuration files are mounted from `config/automations/`
- Use environment variables for broker connections and client IDs
- Support for dynamic configuration reloading during development

## Best Practices

### Error Handling
- Always handle null/undefined payloads gracefully
- Use try-catch blocks around MQTT publish operations
- Log errors with sufficient context for debugging

### Performance
- Avoid blocking operations in MQTT callbacks
- Use efficient state tracking with Maps and Sets
- Clean up timers and subscriptions properly

### Maintainability
- Keep bot logic focused and single-purpose
- Use descriptive names for timeout and state variables
- Document complex timing logic and state transitions
- Write comprehensive tests for all scenarios

## Monitoring Integration

### Development Debugging
- Use `verbose: true` in bot configuration for detailed logging
- Monitor MQTT topics with mosquitto_sub during development
- Check Grafana dashboards for failure patterns in production
