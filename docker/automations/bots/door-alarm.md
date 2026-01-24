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
- **Duplicate messages**: Duplicate door state messages are ignored to prevent multiple timer sets
- **Service restart with door open**: Timers are restored from persisted state, expired alarms trigger immediately
- **Door already open on startup**: Starts monitoring from first state message received
- **Door closes after some alarms**: Only cancels pending alarms, doesn't stop currently sounding alarm

### State Persistence

The bot persists door state and pending alarms to survive service restarts:

- **Door state**: Whether door is currently open or closed
- **Door open time**: Timestamp when door was opened
- **Pending alarms**: Array of scheduled alarms with trigger status

On service restart with door still open:
- Alarms that haven't triggered yet are restored with remaining time
- Alarms that should have triggered during downtime fire immediately
- Already-triggered alarms are not repeated

## MQTT Topics

### Input Topics

- `{doorSensor.statusTopic}` - Door sensor status messages
  - Expected payload: `{ state: true }` (open) or `{ state: false }` (closed)
  - Example: `homy/features/open/front_main_door_open/status`

### Output Topics

- `{alarmDevice.commandTopic}` - Alarm device commands
  - Payload format: `{ alarm: 'ON', volume: string, duration: number, melody: number }`
  - Example: `z2m/house1/floor1-alarm/set`

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

## Troubleshooting

### Common Issues

**Alarms don't trigger when door left open**
- Verify door sensor is publishing state changes to correct MQTT topic
- Enable `verbose: true` to see door state transitions in logs
- Check that `doorSensor.statusTopic` matches your door sensor configuration
- Verify payload format is `{ state: boolean }`

**Alarms trigger but no sound from device**
- Check Zigbee device is online and paired to Zigbee2MQTT
- Verify `alarmDevice.commandTopic` matches your Z2M device friendly name
- Test alarm manually via Z2M web interface or MQTT publish
- Check device battery level (NAS-AB02B0 requires power for alarm)

**Alarms continue after door closes**
- This is expected - closing door only cancels pending alarms, not currently sounding alarm
- Current alarm will stop after its configured `durationSec` expires
- If alarms keep retriggering, check for sensor false positives or duplicate messages

**Alarms lost after service restart**
- With state persistence (implemented), alarms should restore automatically
- Check logs for "restoring timers" messages
- Verify `/app/state/` directory is writable and persisted across restarts
- If state file is corrupt, bot will start fresh with default state

**Duplicate alarm triggers**
- Enable `verbose: true` to check for duplicate door state messages
- Bot automatically ignores duplicate messages with same state
- Check sensor for rapid state flickering (faulty sensor or mounting)

### Debug Information

Enable `verbose: true` in bot configuration to see detailed logging:

```javascript
{
  type: 'door-alarm',
  // ... other config
  verbose: true
}
```

Debug logs include:
- Door state changes (open/closed)
- Duplicate message detection
- Alarm scheduling and triggering
- Timer restoration after restart
- MQTT publish failures
- Payload validation errors

### Health Monitoring

Monitor bot health through:
- **Door state**: Check `persistedCache.doorState` in state file
- **Active alarms**: Check `persistedCache.pendingAlarms` array
- **MQTT connectivity**: Check automations service logs for subscription confirmations
- **Alarm device**: Check Z2M device status and battery level

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

## Related Documentation

- [Door Alarm Bot Implementation](door-alarm.js)
- [Door Alarm Test Suite](door-alarm.test.js)
- [Automation Service CLAUDE.md](../CLAUDE.md)
- [Configuration Examples](../../../config/automations/config.js)
- [Zigbee2MQTT NAS-AB02B0 Device](https://www.zigbee2mqtt.io/devices/NAS-AB02B0.html)
- [State Manager Documentation](../lib/state-manager.js)
