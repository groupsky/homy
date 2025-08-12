# Boiler Controller Documentation

## Overview

The boiler system consists of a 200L Eldom cylindrical water heater (height: 140cm) with dual heating capabilities:
- Electric heater controlled by automation
- Solar heater system (always active when conditions permit)

## Hardware Configuration

### Boiler Specifications
- **Model:** Eldom 200L
- **Type:** Cylindrical water heater
- **Height:** 140cm
- **Volume:** 200L
- **Electric heater:** 3kW single phase
- **Location:** Service room (Сервизно)

### Temperature Sensors
- **Bottom sensor:** Located at h=45cm from base
- **Top sensor:** Located at h=107cm from base

### Control Hardware
- **Electric heater contactor:** Relay bit 14 on `/modbus/dry-switches/relays00-15`
- **Solar circulation pump:** Controlled by external solar heater controller
- **Energy meter:** Connected to `/modbus/secondary/boiler/reading`
- **External solar controller:** Connected to `/modbus/monitoring/solar_heater` (monitoring only)

## MQTT Topics

### Temperature Monitoring
```
homy/features/sensor/temperature_boiler_low/status     # Bottom sensor (45cm)
homy/features/sensor/temperature_boiler_high/status    # Top sensor (107cm)
homy/features/sensor/temperature_solar_panel/status    # Solar panel temperature
homy/features/sensor/temperature_room_service/status   # Service room temperature
```

### Control Topics
```
homy/features/relay/service_boiler_contactor/set       # Electric heater control
homy/features/relay/service_boiler_contactor/status    # Electric heater status
homy/features/relay/solar_heater_circulation/status    # Solar pump status
homy/features/relay/solar_heater_electric_heater/status # Solar controller electric heater
```

### Data Source
```
/modbus/monitoring/solar_heater/reading                # External solar controller (read-only)
  - t1: Bottom boiler temperature
  - t2: Top boiler temperature  
  - t3: Solar panel temperature
  - t6: Service room temperature
  - outputs.p1: Solar circulation pump state
  - outputs.p6: Electric heater recommendation (status only, not control)

/modbus/secondary/boiler/reading                       # Energy meter
  - tot: Total energy consumption (kWh)
  - p: Current power consumption (W)
```

## Automation Logic

### Electric Heater Schedule (`boilerOnSchedule`)
- **Type:** `solar-emitter`
- **Location:** 42.1354°N, 24.7453°E
- **Schedule:**
  - **Turn ON:** Golden hour (sunset)
  - **Turn OFF:** Nadir (solar midnight)
- **Implementation:** `config.js:268-281`

### Solar System (External Controller)
- **External solar controller** manages solar heating logic independently
- **Circulation pump** controlled directly by external controller
- **Temperature monitoring** provided by external controller via Modbus
- **Electric heater recommendation** provided as status (outputs.p6) but not used for control
- **Completely independent** of home automation electric heater schedule

## Home Assistant Integration

### Sensors
- **Boiler Energy Meter:** Total kWh consumption
- **Boiler Heating Status:** Shows "ON" when power > 10W
- **Temperature sensors:** All four temperature readings
- **Circulation Status:** Solar pump operation

### Controls
- **Electric Heater Switch:** Manual override via Home Assistant
- **Device Class:** Outlet (for electric heater contactor)

## System Behavior

### Two Independent Control Systems

1. **External Solar Controller:**
   - Manages solar circulation pump automatically
   - Monitors all temperature sensors (t1, t2, t3, t6)
   - Provides electric heater recommendation (not used for actual control)
   - Operates independently of home automation

2. **Home Automation Electric Control:**
   - Controls electric heater contactor via relay
   - Uses time-based solar schedule (sunset to midnight)
   - Ignores external controller's electric heater recommendation
   - Provides manual override through Home Assistant

### Operation Flow
1. **Temperature monitoring:** All readings come from external solar controller
2. **Solar heating:** External controller handles circulation automatically
3. **Electric heating:** Home automation handles scheduling independently
4. **Energy tracking:** Power consumption monitored separately via energy meter
5. **Manual override:** Available through Home Assistant for electric heater only

## Configuration Files

- **Main config:** `config/automations/config.js:268-308`
- **Feature mappings:** `config/automations/features.js:797-846`  
- **HA discovery:** `config/automations/ha_discovery.js:852-924`

## Safety Features

- **Timeout protection:** Inherent in solar controller
- **Temperature monitoring:** Multiple sensors for system health
- **Manual override:** Available for emergency situations
- **Power monitoring:** Heating status detection via power consumption