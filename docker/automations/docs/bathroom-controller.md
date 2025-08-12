# Bathroom Light Controller

The `bath-lights` bot provides intelligent lighting automation for bathrooms using door sensors, lock sensors, and manual toggle switches.

## Overview

The bathroom controller manages lights based on occupancy detection and user intent, providing:
- **Automatic lighting** based on door and lock states
- **Manual override capability** for user control
- **Privacy mode** when bathroom is locked
- **Energy efficiency** with configurable timeouts
- **Guest-friendly operation** that works like a normal light switch

## Sensor Inputs

### Required Sensors
- **Light Status/Command**: Current light state and control
- **Toggle Switch**: Manual user control (button or switch type)

### Optional Sensors  
- **Door Sensor**: Open/closed state detection
- **Lock Sensor**: Locked/unlocked state detection

## Core Behavior

### Manual Control (Primary Interface)
- **Manual ON**: User presses toggle → lights turn on with extended timeout
- **Manual OFF**: User presses toggle → lights turn off immediately
- **Guest Experience**: Works exactly like a normal light switch

### Automatic Door Control
- **Door Opens**: Lights turn on automatically
- **Door Closes**: Lights turn on and set timeout for auto-off
- **Repeated Messages**: Ignores duplicate sensor messages

### Privacy Lock Mode
- **Lock Engaged**: Lights stay on indefinitely (privacy mode)
- **Lock Disengaged**: Starts grace period timeout for exit
- **Manual Override**: Respected until lock is engaged

## Timeout Configuration

### Timeout Types
- **`closed`**: Auto-off delay when door closes (unlocked)
- **`opened`**: Auto-off delay when door opens  
- **`toggled`**: Auto-off delay after manual activation
- **`unlocked`**: Grace period after unlocking before auto-off

### Priority Logic
1. **Lock State**: Highest priority - cancels all timeouts
2. **Manual Toggle**: Overrides door-based timeouts
3. **Door Timeouts**: Only set if no higher priority timer active
4. **External Control**: Cancels timeouts when lights turned off externally

## User Scenarios

### Guest Usage (Unfamiliar Users)
```
Enter → Manual Switch ON → Use → Manual Switch OFF → Exit
```
- Guest controls lights manually as expected
- Automation handles energy efficiency after guest leaves
- No unexpected behavior during guest visit

### Family Usage (Familiar Users)
```
Enter → [Automatic ON] → Use → Exit → [Automatic OFF after timeout]
```
- Can rely on automation for hands-free operation
- Manual override always available when needed

### Privacy Activities (Shower, etc.)
```
Enter → Manual/Auto ON → Lock → [Lights stay on] → Unlock → Grace period → Auto OFF
```
- Lock ensures lights stay on during private activities
- Unlock provides grace period for cleanup and exit

## Configuration Examples

### Bath1: Guest/Daytime Bathroom
**Usage**: Mixed users (adults, kids, guests), door usually left open
```javascript
timeouts: {
  closed: 2 * 60000,    // 2 minutes - accommodate kids + adults
  opened: 12 * 60000,   // 12 minutes - primary timeout (door usually open)
  toggled: 25 * 60000,  // 25 minutes - guest + kid friendly
  unlocked: 3 * 60000,  // 3 minutes - accommodate kids cleanup time
}
```

### Bath2: Kids Bathroom  
**Usage**: Primary kids bathroom
```javascript
timeouts: {
  closed: 3 * 60000,    // 3 minutes - kids take longer
  opened: 6 * 60000,    // 6 minutes - kids might leave door open briefly
  toggled: 25 * 60000,  // 25 minutes - kids forget about automation
  unlocked: 4 * 60000,  // 4 minutes - kids need more transition time
}
```

### Bath3: Master Bathroom
**Usage**: Adult bathroom with shower
```javascript
timeouts: {
  closed: 2 * 60000,    // 2 minutes - adult efficiency
  opened: 10 * 60000,   // 10 minutes - post-shower ventilation
  toggled: 15 * 60000,  // 15 minutes - intentional extended use
  unlocked: 3 * 60000,  // 3 minutes - standard adult transition
}
```

## Implementation Details

### State Management
- **Door State Tracking**: Prevents duplicate commands on repeated messages
- **Timer Coordination**: Ensures only appropriate timers are active
- **State Validation**: Timeout callbacks check current state before executing

### MQTT Topics
```
Input Topics:
- {featuresPrefix}/open/{bathroom}_door_open/status
- {featuresPrefix}/lock/{bathroom}_door_lock/status  
- {featuresPrefix}/{toggle_type}/{bathroom}_switch_left/status

Output Topics:
- {featuresPrefix}/light/{bathroom}_ceiling_light/set
- {featuresPrefix}/light/{bathroom}_ceiling_light/status
```

### Error Handling
- **Sensor Disconnection**: Graceful degradation without sensors
- **Message Ordering**: Handles out-of-order MQTT messages
- **Timer Conflicts**: Proper priority resolution between competing timeouts

## Troubleshooting

### Common Issues

**Lights turn off too quickly**
- Check timeout configuration for user type
- Verify manual toggle timeout is appropriate
- Consider door usage patterns (open/closed)

**Lights don't turn off automatically**  
- Verify lock sensor is not stuck in locked state
- Check if manual override is active
- Review recent activity for timer conflicts

**Guest confusion**
- Ensure manual toggle timeout is generous (20-25 minutes)
- Verify lights respond immediately to manual control
- Check that automation doesn't interfere during guest visit

### Debug Information
Enable verbose logging to see:
- Timer setting and cancellation events
- State change detection
- Timeout execution decisions
- Reason codes in MQTT messages (`r` field)

## Related Documentation
- [Bath-Lights Bot Implementation](../bots/bath-lights.js)
- [Bath-Lights Test Suite](../bots/bath-lights.test.js)
- [Configuration Examples](../../config/automations/config.js)