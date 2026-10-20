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
- **External solar controller:** Connected to `/modbus/monitoring/solar_heater` (monitoring only; `sr04-sync-clock` sets its clock and nothing else)

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

### Electric Heater Control (`boilerController`)

The heater is **threshold-based**, with one time rule: it does not heat in the hour before the night
tariff zone (see [Night tariff hold](#night-tariff-hold)). The legacy `boilerOnSchedule`
`solar-emitter` bot (ON at golden hour, OFF at nadir) was removed in `11ed714` and no longer exists.

- **Type:** `boiler-controller` (`docker/automations/bots/boiler-controller.js`)
- **Configuration:** `config/automations/boiler-controller-config.js`
- **Inputs:** boiler top/bottom temperature, solar collector temperature, service-room ambient, and
  the solar circulation pump state — all via `homy/features/...` topics
- **Output:** `homy/features/relay/service_boiler_contactor/set`
- **Status:** `homy/automation/boiler_controller/status`, forwarded to InfluxDB
  (`automation_status`) by `automation-events-processor`

**Live thresholds** (`boiler-controller-config.js`):

| Setting | Value | Meaning |
|---|---|---|
| `maxSafe` | 85 °C | Safety shutoff |
| `comfortMin` | 47 °C | Heat below this |
| `hysteresis` | 3 °C | Stop at `comfortMin + hysteresis` = **50 °C** |
| `emergencyMin` | 30 °C | Emergency heating below this |
| `solarAdvantageMin` | 5 °C | Collector this far above tank top ⇒ defer to solar |
| `solarDisadvantageMax` | -100 °C | Effectively disables the "solar insufficient, boost" branch |
| `nightTariff.floor` | 40 °C | The night tariff hold does not apply below this (until 43 °C once on) |
| `maxInputAgeMs` | 10 min (default) | Boiler top/bottom temperature older than this ⇒ OFF, `input_stale` |
| `manualOverrideExpiry` | 24 h | Default expiry for `manual_on`/`manual_off`; an object payload's `duration` overrides it. **Vacation modes do not use it** — they expire after `days × 24 − 6` hours (66 / 114 / 162 / 234 / 330 h) |

**Decision order** (first match wins, `makeDecision()` in the bot):

1. Manual override active (`manual_on` / `manual_off` / `vacation_*`) → forced state
2. Boiler top or bottom temperature older than `maxInputAgeMs` → OFF, `input_stale` (see
   [Old input](#old-input))
3. `top >= maxSafe` → OFF, `safety_shutoff_overheated`
4. `top < emergencyMin` → ON, `emergency_heating_top_cold`
5. `bottom < emergencyMin` → ON, `emergency_heating_bottom_cold`
6. In the night tariff hold **and** `top >= nightTariff.floor` (plus `hysteresis` while the element is on) → OFF,
   `night_tariff_hold`
7. `top < comfortMin` → ON, `comfort_heating_insufficient`
8. `collector - top >= solarAdvantageMin` **and** the pump is circulating → OFF, `solar_priority_available`
9. `collector - top <= solarDisadvantageMax` → ON, `solar_insufficient_boost_needed`
10. `top >= comfortMin + hysteresis` → OFF, `temperature_sufficient`
11. Otherwise hold the current state, `hysteresis_zone_maintain_{true,false}`

**Control modes** (`homy/features/control_mode/boiler_controller/set`): `automatic`, `manual_on`,
`manual_off`, `vacation_3d`, `vacation_5d`, `vacation_7d`, `vacation_10d`, `vacation_14d`.

The 50 °C cutout from step 10 is what makes `max(t2)` a usable solar-contribution signal: a day whose
top temperature never exceeds 50 °C got all of its heat from the immersion heater. That is the basis
of the `boiler-solar-no-contribution` alert — see
`config/grafana/dashboards/BOILER_CONTROLLER_README.md`.

### Night tariff hold

The house pays a day and a night price for electricity. The night zone, on the local wall clock
(`Europe/Sofia`), is:

| Months | Night zone |
|---|---|
| 1 November to 31 March | 22:00–06:00 |
| 1 April to 31 October | 23:00–07:00 |

The zone hours change on 1 April and 1 November, not on the clock-change days. Issue #1740 has the
sources and the cost model.

- The element does not run from `holdBeforeMinutes` (60) before the zone starts until
  `marginMinutes` (10) after it: 21:00–22:10 in winter, 22:00–23:10 in summer. A run that is on when
  the hold begins is switched off. The 10 minutes after the zone start allow for drift of the meter
  clock.
- After the hold, the normal rules apply again on the next temperature reading. The element starts
  if the top is under `comfortMin`. A run that the hold cut off does not resume while the top is
  still between `comfortMin` and `comfortMin + hysteresis` (47–50 °C).
- **The floor**: when the top is under `nightTariff.floor` (40 °C), the hold does not apply, and the
  element heats as usual. Once on, it runs until the top reaches the floor plus `hysteresis` (43 °C).
  Without this band the 0.1 K jitter of the reading would switch the contactor every few seconds.
- The safety and emergency rules (steps 3–5) come before the hold, so a cold tank always heats.
- The hold uses the month and time in `nightTariff.timeZone`, never a fixed UTC offset.
- Manual and vacation modes (step 1) are not affected.

**To change the zone table**, edit `nightTariff` in `config/automations/boiler-controller-config.js`.
Each entry of `zones` lists its months (1–12) and the zone `start` and `end` as `HH:MM`. Every month
must be in exactly one entry; a month in no entry has no hold. Only `start` is used today; `end` is
there to keep the table complete. To turn the hold off, remove `nightTariff`. Then run the tests in
`docker/automations/bots/boiler-controller-night-tariff.test.js`, which read the committed config.
The Home Assistant automation `grid_tariff_by_zone` has the same table for the energy dashboard
(`docs/energy-dashboard.md`); change both together.

### Solar System (External Controller)
- **External solar controller** manages solar heating logic independently
- **Circulation pump** controlled directly by external controller
- **Temperature monitoring** provided by external controller via Modbus
- **Electric heater recommendation** provided as status (outputs.p6) but not used for control
- **Completely independent** of the home automation electric heater control

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

2. **Home Automation Electric Control (`boilerController` bot):**
   - Controls electric heater contactor via relay
   - Threshold-based on the tank temperatures reported by the external controller, plus the night
     tariff hold
   - Reads the pump state (`outputs.p1`) so it can defer to solar, but ignores the external
     controller's electric heater recommendation (`outputs.p6`)
   - Provides manual override and vacation modes through Home Assistant

### Operation Flow
1. **Temperature monitoring:** All readings come from external solar controller
2. **Solar heating:** External controller handles circulation automatically
3. **Electric heating:** `boilerController` decides on every temperature update, using the thresholds
   above — it defers to solar when the collector is at least 5 °C above the tank top *and* the pump
   is running, and otherwise holds the top between 47 °C and 50 °C, except in the night tariff hold
4. **Energy tracking:** Power consumption monitored separately via energy meter
5. **Manual override:** Available through Home Assistant for electric heater only

### Old input

When the top or the bottom temperature is older than `maxInputAgeMs` (10 min by default), the element
is OFF with reason `input_stale` (#1743), and the bot posts one Telegram message through
`telegram-bridge`. When both temperatures arrive again it posts one "back" message and decides as
usual. The age is checked on every reading and every 30 s, and taken from the message's own `_tz`, so
old retained values after a start count as old; a temperature not seen yet counts from the start.
The 15-minute heartbeat also decides again, so a manual mode expires on time during an outage. Manual
and vacation modes still win, so a person can force heating during a long outage. The safe state
needs no internet; only the message does, and it follows the bridge's quiet hours. A disabled bot
sends nothing. The Grafana rule `boiler-temperature-sensor-failure` reports the same outage on its own,
about 35 minutes in.

If cold water during a long outage turns out to be a problem, the agreed alternative is to allow the
element only in the night tariff zone while the input is old, instead of OFF.

### Known blind spot

The bot cannot tell a working solar circuit from a broken one: it only sees the collector temperature
the external controller reports. When that probe failed on 2026-06-08 it read ~35 °C against >110 °C
actual, so both the SR-04 and the bot correctly concluded there was no solar advantage and the
immersion heater carried the entire load for 63 days. Detection lives in the Grafana alerts
(`boiler-solar-circulation-stuck`, `boiler-solar-no-contribution`), not in this bot — see issue #1472
and `config/grafana/dashboards/BOILER_CONTROLLER_README.md`.

## Configuration Files

- **Bot config:** `config/automations/boiler-controller-config.js`
- **Bot implementation:** `docker/automations/bots/boiler-controller.js`
- **Feature mappings:** `config/automations/features.js:797-846`  
- **HA discovery:** `config/automations/ha_discovery.js` — contactor switch (~:876), temperature
  sensors (~:942-989 — boiler low/high, solar panel, service room), control-mode select (~:1017)

## Safety Features

- **Timeout protection:** Inherent in solar controller
- **Temperature monitoring:** Multiple sensors for system health
- **Manual override:** Available for emergency situations
- **Power monitoring:** Heating status detection via power consumption