# Door Alarm Bot

## Overview

The door alarm bot monitors a door sensor and triggers escalating alarms on a Zigbee siren device when the door is left open for extended periods. The alarm escalates in both duration and volume over time to ensure the issue is addressed.

## Features

- Configurable escalation steps with custom delays, durations, and volumes
- Automatic timer cancellation when door closes
- Resets escalation sequence when door opens again
- Support for custom alarm melodies
- Optional verbose logging

## Configuration

### Basic Configuration

```javascript
{
  type: 'door-alarm',
  doorSensor: {
    statusTopic: 'homy/features/open/front_main_door_open/status'
  },
  alarmDevice: {
    commandTopic: 'z2m/house1/floor1-alarm/set'
  },
  escalationSteps: [
    { delayMs: 60000, durationSec: 10, volume: 'low' },       // 1 minute
    { delayMs: 120000, durationSec: 20, volume: 'medium' },   // 2 minutes
    { delayMs: 180000, durationSec: 60, volume: 'high' }      // 3 minutes
  ],
  melody: 10,
  verbose: false
}
```

### Configuration Parameters

#### Required Parameters

- **`doorSensor.statusTopic`** (string): MQTT topic for door sensor status
  - Example: `'homy/features/open/front_main_door_open/status'`
  - Expected payload format: `{ state: true }` (open) or `{ state: false }` (closed)

- **`alarmDevice.commandTopic`** (string): MQTT topic for alarm device commands
  - Example: `'z2m/house1/floor1-alarm/set'`
  - See Zigbee2MQTT device documentation for supported commands

- **`escalationSteps`** (array): Array of escalation step objects
  - Each step defines when and how to trigger the alarm
  - Steps are executed cumulatively (all alarms fire at their respective delays)
  - Format: `{ delayMs, durationSec, volume }`

#### Escalation Step Parameters

- **`delayMs`** (number): Delay in milliseconds from when door opens
  - Example: `60000` = 1 minute, `120000` = 2 minutes

- **`durationSec`** (number): Alarm duration in seconds
  - Range: 0-1800 (0-30 minutes)
  - Example: `10` = 10 seconds, `60` = 1 minute

- **`volume`** (string): Alarm volume level
  - Valid values: `'low'`, `'medium'`, `'high'`

#### Optional Parameters

- **`melody`** (number): Alarm melody/sound selection
  - Range: 1-18 (device supports 18 different tunes)
  - Default: `10`
  - See device documentation for available melodies

- **`verbose`** (boolean): Enable detailed logging
  - Default: `false`
  - When enabled, logs door state changes and alarm triggers

## Behavior

### Normal Operation

1. **Door Closed**: No alarms, all timers cleared
2. **Door Opens**: Schedules all escalation alarms
3. **Alarm Triggers**: Each alarm fires at its configured delay with specified volume and duration
4. **Door Closes**: Immediately cancels all pending alarms

### Escalation Example

Using the default configuration:

1. **T+0s**: Door opens, alarms scheduled
2. **T+60s**: First alarm (10s, low volume)
3. **T+120s**: Second alarm (20s, medium volume)
4. **T+180s**: Third alarm (60s, high volume)
5. **T+any**: Door closes → all future alarms cancelled

### Edge Cases

- **Rapid open/close cycles**: Timers reset on each door state change
- **Door already open on startup**: Starts monitoring immediately
- **Door closes after some alarms**: Only cancels pending alarms, doesn't stop current alarm

## Device Compatibility

### Supported Devices

- **Neo Coolcam NAS-AB02B0**: Zigbee siren with temperature/humidity sensor
  - Product page: https://www.zigbee2mqtt.io/devices/NAS-AB02B0.html

### MQTT Command Format

Commands published to the alarm device topic:

```javascript
{
  alarm: 'ON',         // Trigger alarm
  volume: 'low',       // Volume level
  duration: 10,        // Duration in seconds
  melody: 10           // Melody number
}
```

## Testing

The bot includes comprehensive Jest tests covering:

- Timer scheduling and execution
- Door state change handling
- Escalation step progression
- Timer cancellation on door close
- Custom configuration support
- Verbose logging behavior
- Edge case handling

Run tests:

```bash
npm test -- door-alarm.test.js
```

## Example Configurations

### Gentle Escalation (Long Delays)

```javascript
{
  type: 'door-alarm',
  doorSensor: { statusTopic: 'homy/features/open/front_main_door_open/status' },
  alarmDevice: { commandTopic: 'z2m/house1/floor1-alarm/set' },
  escalationSteps: [
    { delayMs: 300000, durationSec: 5, volume: 'low' },    // 5 min: 5s low
    { delayMs: 600000, durationSec: 10, volume: 'medium' }, // 10 min: 10s medium
    { delayMs: 900000, durationSec: 30, volume: 'high' }    // 15 min: 30s high
  ],
  melody: 5
}
```

### Aggressive Escalation (Quick Response)

```javascript
{
  type: 'door-alarm',
  doorSensor: { statusTopic: 'homy/features/open/back_door_open/status' },
  alarmDevice: { commandTopic: 'z2m/house1/floor1-alarm/set' },
  escalationSteps: [
    { delayMs: 30000, durationSec: 15, volume: 'medium' },  // 30s: 15s medium
    { delayMs: 60000, durationSec: 30, volume: 'high' },    // 1 min: 30s high
    { delayMs: 90000, durationSec: 60, volume: 'high' }     // 1.5 min: 60s high
  ],
  melody: 18,
  verbose: true
}
```

### Single-Step Alert

```javascript
{
  type: 'door-alarm',
  doorSensor: { statusTopic: 'homy/features/open/garage_door_open/status' },
  alarmDevice: { commandTopic: 'z2m/house1/floor1-alarm/set' },
  escalationSteps: [
    { delayMs: 120000, durationSec: 30, volume: 'high' }    // 2 min: 30s high
  ],
  melody: 1
}
```

## Architecture

### Design Principles

- **DRY**: Escalation logic implemented once, configuration drives behavior
- **KISS**: Simple state tracking (door open/closed boolean, timer array)
- **YAGNI**: Only implements requested features, no over-engineering

### State Management

- **No persistent cache**: State is ephemeral, resets on service restart
- **Local variables**: `isDoorOpen` boolean and `timers` array
- **Timer management**: All timers cleared on door close or new door open

### Dependencies

- MQTT client for pub/sub
- No external dependencies beyond automation framework
