# Power Cycle on Low Power Bot

## Overview

The power-cycle-on-low-power bot monitors power consumption on a specific electrical phase and automatically triggers a power cycle (OFF then ON) when power remains continuously below a threshold for a configured duration. This is useful for devices that may enter a fault state under low power conditions, such as circulation pumps or heat pumps.

## Features

- Monitors power consumption from Modbus or MQTT sources
- Configurable power threshold and duration
- Automatic power cycle via Zigbee or MQTT-controlled devices
- Prevents repeated cycling during ongoing low power conditions
- State persistence for timer restoration after service restarts
- Optional verbose logging

## Configuration

### Basic Configuration

```javascript
{
  type: 'power-cycle-on-low-power',
  powerMonitor: {
    statusTopic: '/modbus/tetriary/heat_pump/reading',
    powerField: 'b_ap',
    threshold: 30,
    durationMs: 180000  // 3 minutes
  },
  controlDevice: {
    commandTopic: 'z2m/house1/circulation-heatpump/set'
  },
  powerCycle: {
    offDurationMs: 5000  // 5 seconds
  },
  verbose: false
}
```

### Configuration Parameters

#### Required Parameters

- **`powerMonitor.statusTopic`** (string): MQTT topic for power monitoring
  - Example: `'/modbus/main/heat_pump/+'`
  - Supports wildcard topics for multiple devices

- **`powerMonitor.powerField`** (string): Field name containing power value in MQTT payload
  - Example: `'b_ap'` for phase B apparent power
  - Common fields: `'a_ap'`, `'b_ap'`, `'c_ap'`, `'power'`, `'watts'`

- **`powerMonitor.threshold`** (number): Power threshold in watts
  - Example: `30` means trigger when power drops below 30W
  - Must be a positive number
  - This is the maximum power for "low power" condition
  - Any power below this threshold will trigger cycle (including 0W when device is turned off)

- **`powerMonitor.durationMs`** (number): Duration in milliseconds power must stay below threshold
  - Example: `180000` = 3 minutes
  - Must be a positive number

- **`controlDevice.commandTopic`** (string): MQTT topic for power cycle commands
  - Example: `'z2m/house1/circulation-heatpump/set'`
  - Must support `{state: 'OFF'}` and `{state: 'ON'}` commands

- **`powerCycle.offDurationMs`** (number): Duration in milliseconds to keep device OFF
  - Example: `5000` = 5 seconds
  - Must be at least 5000ms (5 seconds)
  - Too short may not allow device to fully reset
  - Too long may cause unnecessary downtime

#### Optional Parameters

- **`verbose`** (boolean): Enable detailed logging
  - Default: `false`
  - When enabled, logs power updates, threshold crossings, and cycle operations

## Behavior

### Normal Operation

1. **Power Above Threshold**: No action, monitoring continues
2. **Power Below Threshold** (including 0W): Starts low power timer, continues monitoring
3. **Power Stays Low for Duration**: Triggers power cycle
4. **Power Recovers**: Cancels timer, resets state
5. **During Power Cycle**: Ignores new power readings, prevents repeated cycles
6. **Power Line Offline**: No MQTT messages received, naturally prevents triggering

### Power Cycle Sequence

1. **T+0s**: Send OFF command to device
2. **T+[offDurationMs]**: Send ON command to device
3. Reset cycling flag, ready for new incidents

### Low Power Detection

Power must remain **continuously** below threshold for the full duration:
- If power recovers above threshold before duration expires, timer resets
- If power drops again after recovery, timer starts fresh
- Only one power cycle is triggered per low power incident

### Repeated Cycling Prevention

The bot includes safeguards to prevent repeated power cycles:
- **During cycling**: Ignores all power readings, cannot trigger new cycle
- **After cycling**: Requires power to return to normal before allowing new cycle
- **Continuous low power**: Only triggers once per incident, even if power stays low

### State Persistence

The bot persists state to survive service restarts:

- **Low power start time**: Timestamp when power first dropped below threshold
- **Cycling in progress**: Flag indicating active power cycle operation
- **Last power value**: Most recent power reading
- **Cycle OFF time**: Timestamp when OFF command was sent (for ON timer restoration)

On service restart:
- If power cycle was in progress (OFF command sent), ON timer is restored:
  - If remaining time > 0, schedules ON command for remaining duration
  - If time already elapsed, sends ON command immediately
- If low power condition persisted (but not cycling), timer is restored with remaining time
- If low power timer already expired during downtime, power cycle triggers immediately

## MQTT Topics

### Input Topics

- `{powerMonitor.statusTopic}` - Power monitoring messages
  - Expected payload: Object with power field (e.g., `{ b_ap: 25.5 }`)
  - Power value must be numeric
  - Example: `/modbus/main/heat_pump/reading`

### Output Topics

- `{controlDevice.commandTopic}` - Power control commands
  - Payload format: `{ state: 'OFF' }` or `{ state: 'ON' }`
  - Example: `z2m/house1/circulation-heatpump/set`

## Device Compatibility

### Supported Power Monitors

- **Modbus Energy Meters**: Direct power readings via modbus-serial service
  - SDM120, SDM230, SDM630 (Eastron meters)
  - Custom Modbus devices with power registers

- **Zigbee Smart Plugs**: Power monitoring through Zigbee2MQTT
  - Sonoff ZBMINI, ZBMINIR2 with power monitoring
  - Tuya/SmartLife smart plugs

### Supported Control Devices

- **Zigbee Smart Switches**: Compatible with Zigbee2MQTT
  - Sonoff ZBMINIR2, ZBMINI
  - Any Z2M device supporting `state: ON/OFF` commands

- **Modbus Relays**: Direct control via modbus-serial service
  - Custom relay boards
  - Industrial relay modules

## Testing

The bot includes comprehensive Jest tests covering:

- Configuration validation
- Power threshold detection
- Timer scheduling and cancellation
- Power recovery handling
- Rapid power fluctuation handling
- Repeated cycling prevention
- MQTT publish error handling
- State persistence and restoration
- Custom configuration support
- Verbose logging behavior
- Edge cases (zero power, threshold boundary, etc.)

Run tests:

```bash
npm test -- power-cycle-on-low-power.test.js
```

## Troubleshooting

### Common Issues

**Power cycle doesn't trigger when power is low**
- Verify power monitor is publishing to correct MQTT topic
- Check that `powerField` matches the field name in MQTT payload
- Enable `verbose: true` to see power updates and threshold crossings
- Confirm power stays continuously below threshold for full duration
- Check that `threshold` value is appropriate for your device

**Device doesn't respond to power cycle commands**
- Verify control device is online and paired (for Zigbee devices)
- Test manual control via Z2M web interface or MQTT publish
- Check `controlDevice.commandTopic` matches your device configuration
- Verify device supports `{state: 'OFF'}` and `{state: 'ON'}` command format

**Repeated power cycles occur continuously**
- This indicates power is not recovering after cycle
- May indicate a hardware fault requiring manual intervention
- Consider increasing `threshold` if device operates normally at low power
- Check device health and connectivity

**Power cycle lost after service restart**
- With state persistence (implemented), cycle should restore automatically
- Check logs for "restoring low power timer" messages
- Verify `/app/state/` directory is writable and persisted across restarts
- If state file is corrupt, bot will start fresh with default state

**Power fluctuations cause false triggers**
- Increase `durationMs` to require longer continuous low power period
- Lower `threshold` if device normally operates near current threshold
- Check for electrical noise or measurement issues in power monitoring

### Debug Information

Enable `verbose: true` in bot configuration to see detailed logging:

```javascript
{
  type: 'power-cycle-on-low-power',
  // ... other config
  verbose: true
}
```

Debug logs include:
- Power updates with current values
- Threshold crossings and timer starts
- Timer cancellations when power recovers
- Power cycle operations (OFF/ON commands)
- Timer restoration after restart
- MQTT publish failures
- Payload validation errors

### Health Monitoring

Monitor bot health through:
- **Low power state**: Check `persistedCache.lowPowerStartTime` in state file
- **Cycling status**: Check `persistedCache.cyclingInProgress` flag
- **Power readings**: Check `persistedCache.lastPowerValue` for latest reading
- **MQTT connectivity**: Check automations service logs for subscription confirmations
- **Device status**: Monitor control device online status and responsiveness

## Example Configurations

### Heat Pump Circulation Pump (Default)

```javascript
{
  type: 'power-cycle-on-low-power',
  powerMonitor: {
    statusTopic: '/modbus/tetriary/heat_pump/reading',
    powerField: 'b_ap',
    threshold: 30,
    durationMs: 180000  // 3 minutes
  },
  controlDevice: {
    commandTopic: 'z2m/house1/circulation-heatpump/set'
  },
  powerCycle: {
    offDurationMs: 5000  // 5 seconds
  },
  verbose: false
}
```

### Sensitive Device (Quick Response)

```javascript
{
  type: 'power-cycle-on-low-power',
  powerMonitor: {
    statusTopic: '/modbus/monitoring/critical_device/reading',
    powerField: 'power',
    threshold: 10,
    durationMs: 300000  // 5 minutes
  },
  controlDevice: {
    commandTopic: 'z2m/house1/critical-device-relay/set'
  },
  powerCycle: {
    offDurationMs: 5000  // 5 seconds (minimum enforced)
  },
  verbose: true
}
```

### Industrial Equipment (Long Reset)

```javascript
{
  type: 'power-cycle-on-low-power',
  powerMonitor: {
    statusTopic: 'z2m/factory/machine-power-monitor',
    powerField: 'power',
    threshold: 100,
    durationMs: 1800000  // 30 minutes
  },
  controlDevice: {
    commandTopic: '/modbus/factory/relay-board/write'
  },
  powerCycle: {
    offDurationMs: 30000  // 30 seconds
  },
  verbose: true
}
```

## Architecture

### Design Principles

- **DRY**: Power monitoring and cycling logic implemented once, configuration drives behavior
- **KISS**: Simple state tracking (timestamp, boolean flags, last value)
- **YAGNI**: Only implements requested features, no over-engineering

### State Management

- **Persistent cache**: State survives service restarts
- **Reactive updates**: Automatic persistence on state changes
- **Timer restoration**: Continues monitoring across restarts
- **Cycling protection**: Prevents concurrent cycles

### Dependencies

- MQTT client for pub/sub
- No external dependencies beyond automation framework
- Compatible with any MQTT-enabled power monitor and control device

## Use Cases

### Heat Pumps and Circulation Pumps

Heat pumps with circulation pumps may enter fault states when flow is restricted. Low power consumption indicates the pump has stopped. A power cycle often clears the fault and restores operation.

**Configuration considerations:**
- Set `threshold` above pump standby power but below normal operation
- Use 3-5 minute duration for responsive action on stuck pumps
- 5-10 second OFF duration is usually sufficient for pump reset
- If pump is turned off (0W), bot will trigger power cycle to turn it back on
- If power line is offline, meter stops sending messages so bot naturally won't trigger

### Smart Plugs and Appliances

Smart plugs may lose connectivity or enter fault states. Monitoring appliance power consumption can detect these issues and trigger automatic recovery.

**Configuration considerations:**
- Set `threshold` based on appliance standby power
- Longer duration (30+ minutes) to avoid false triggers
- Minimum 5 second OFF duration (enforced) for safe cycling

### Industrial Equipment

Manufacturing equipment may require periodic resets when operating at low capacity or during fault conditions.

**Configuration considerations:**
- Higher `threshold` based on equipment specifications
- Longer durations to confirm true fault conditions (avoid cycling during normal operation)
- Longer OFF duration if equipment requires full power cycle

## Related Documentation

- [Power Cycle Bot Implementation](power-cycle-on-low-power.js)
- [Power Cycle Test Suite](power-cycle-on-low-power.test.js)
- [Automation Service CLAUDE.md](../CLAUDE.md)
- [Configuration Examples](../../../config/automations/config.js)
- [Modbus Serial Service](../../modbus-serial/CLAUDE.md)
- [Zigbee2MQTT Integration](../../zigbee2mqtt/CLAUDE.md)
- [State Manager Documentation](../lib/state-manager.js)
