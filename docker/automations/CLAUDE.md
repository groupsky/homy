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
    persistedCache: {
        version: 2,
        default: {
            count: 0,
            items: [],
            settings: { timeout: 5000 }
        },
        migrate: ({ version, defaultState, state }) => {
            // Migration logic when version or default changes
            if (!state.items) state.items = []
            if (!state.settings) state.settings = defaultState.settings
            return state
        }
    },

    start: async ({ mqtt, persistedCache }) => {
        // persistedCache is automatically created and migrated
        // Subscribe to MQTT topics
        mqtt.subscribe(config.inputTopic, (payload) => {
            // Direct property updates - automatic persistence
            persistedCache.someProperty = newValue
            persistedCache.arrayProperty[index] = newArrayValue

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
- **State**: No persistent state - stateless operation

#### `bath-lights` - Occupancy-based lighting
- **Purpose**: Bathroom lighting automation with timeout logic
- **Features**: Door/lock sensors, toggle switches, multiple timeout scenarios
- **State**: Uses persistent cache for timeout management and light verification
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
- **State**: Uses persistent cache for switch state tracking

#### `stateful-counter` - Example with persistent cache and migration
- **Purpose**: Demonstrates persistent cache patterns with versioning
- **Features**: Incrementing counter with history tracking and reset functionality
- **State**: Complete example of persistent cache with migration
- **Example**:
  ```javascript
  module.exports = (name, config) => ({
    persistedCache: {
      version: 2,
      default: {
        count: 0,
        lastReset: new Date().toISOString(),
        totalIncrements: 0,
        history: []
      },
      migrate: ({ version, defaultState, state }) => {
        // Migration: add history array for v2
        if (!state.history) state.history = []
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      mqtt.subscribe(config.incrementTopic, (message) => {
        const increment = message.increment || 1
        persistedCache.count += increment
        persistedCache.totalIncrements += 1

        // Add to history
        persistedCache.history.push({
          timestamp: new Date().toISOString(),
          increment,
          newCount: persistedCache.count
        })

        // Keep only last 10 entries
        if (persistedCache.history.length > 10) {
          persistedCache.history = persistedCache.history.slice(-10)
        }
      })
    }
  })
  ```

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

### MQTT Publishing
- **Important**: The `mqtt.publish()` function expects JavaScript objects, not JSON strings
- The framework automatically adds metadata (`_bot`, `_tz`) and converts to JSON
- **Correct**: `mqtt.publish(topic, { state: true, reason: 'heating' })`
- **Incorrect**: `mqtt.publish(topic, JSON.stringify({ state: true, reason: 'heating' }))`

### MQTT Subscription
- **Important**: The `mqtt.subscribe()` callback receives parsed JavaScript objects, not JSON strings
- The framework automatically parses incoming JSON payloads using `JSON.parse(payload.toString())`
- **Correct**: `mqtt.subscribe(topic, (payload) => { const value = payload.state })`
- **Incorrect**: `mqtt.subscribe(topic, (payload) => { const data = JSON.parse(payload) })`

### Feature Integration
- Use the features service for device abstraction
- Subscribe to `homy/features/{type}/{name}/status` for device states
- Publish to `homy/features/{type}/{name}/set` for device commands

### Configuration Management
- Configuration files are mounted from `config/automations/`
- Use environment variables for broker connections and client IDs
- Support for dynamic configuration reloading during development

## Best Practices

### State Management
- **Declarative cache definition**: Define cache structure in `persistedCache` object
- **Automatic cache creation**: Cache is automatically created and passed to `bot.start()`
- **Reactive persistence**: Direct property mutations trigger automatic persistence with debouncing
- **Version-based migration**: Migration function handles schema changes
- **Deterministic serialization**: Uses fast-json-stable-stringify for consistent JSON output

**Reactive Pattern:**
```javascript
module.exports = (name, config) => ({
    persistedCache: {
        version: 2,  // Increment when cache structure changes
        default: {   // Initial cache structure
            count: 0,
            items: [],
            settings: { timeout: 5000 }
        },
        migrate: ({ version, defaultState, state }) => {
            // Called when version or defaultState changes
            // Migration logic - modify state and return it
            if (!state.items) state.items = []
            if (version >= 2 && !state.settings) {
                state.settings = defaultState.settings
            }
            return state
        }
    },

    start: async ({ mqtt, persistedCache }) => {
        // persistedCache is ready to use - no initialization needed
        persistedCache.count += 1  // Direct mutations trigger persistence
        persistedCache.items.push('item')
        persistedCache.settings.timeout = 10000
    }
})
```

**Cache Migration Design:**
- **Migration triggers**: Runs when `version` number or `default` structure changes
- **Migration function**: Receives `{ version, defaultState, state }` object
- **Failure handling**: Missing migration warns and discards old cache (safe fallback)
- **Cache semantics**: Designed for non-critical data that can be safely reset
- **Deterministic comparison**: Uses stable JSON stringification for reliable change detection

**Reactive Cache Manager Design:**
- Built on @vue/reactivity for automatic change detection
- Direct property mutations trigger persistence automatically
- Deep watching for nested objects and arrays
- File I/O happens asynchronously with debouncing in the background
- No manual synchronization required - reduces developer errors
- Persistence failures are logged internally, no error handling needed

### Error Handling
- Always handle null/undefined payloads gracefully
- Use try-catch blocks around MQTT publish operations
- Log errors with sufficient context for debugging
- Handle state persistence failures without affecting bot operation

### Performance
- Avoid blocking operations in MQTT callbacks
- Use efficient state tracking with Maps and Sets
- Clean up timers and subscriptions properly
- Update local state immediately for fast reads

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
