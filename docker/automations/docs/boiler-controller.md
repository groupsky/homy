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
- **Bottom sensor:** h=45cm from base, inside the lower serpentine (the solar coil), not in the open
  tank water (confirmed by the owner on 2026-11-05). It reads the coil, so the solar pump and the cold
  water of a draw move it first and fast.
- **Top sensor:** Located at h=107cm from base

### Control Hardware
- **Electric heater contactor:** Relay bit 14 on `/modbus/dry-switches/relays00-15`
- **Solar circulation pump:** Controlled by external solar heater controller
- **Energy meter:** Connected to `/modbus/secondary/boiler/reading`
- **External solar controller:** Connected to `/modbus/monitoring/solar_heater` (monitoring only; `sr04-sync-clock` sets its clock and nothing else)

## MQTT Topics

### Temperature Monitoring
```
homy/features/sensor/temperature_boiler_low/status     # Bottom sensor (45cm, inside the lower serpentine)
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

The heater is **threshold-based**, with time rules around the night tariff zone: it does not heat in
the hour before the zone (see [Night tariff hold](#night-tariff-hold)), and it heats the top to 55 °C
just before that hour and in the night zone (see [Evening draw](#evening-draw-top-up-boost-and-start-on-a-draw)).
It also starts as soon as a hot-water draw begins. It also does not start while the
dishwasher runs or the house load is high (see [Load stagger](#load-stagger)). The legacy `boilerOnSchedule`
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
| `hotWaterLimit` | 55 °C | The top-up, boost and draw rules never heat the top above this (no mixing valve, #1473) |
| `dayTopUp` | 90 min, 55 °C | Heat the top to 55 °C in the 90 min before the hold (19:30–21:00 winter, 20:30–22:00 summer) |
| `nightBoostTarget` | 55 °C | Heat the top to 55 °C from the end of the hold to the end of the night zone |
| `drawDropK` / `drawWindowMinutes` | 3 K / 10 min | A fall of the bottom reading this big this fast is a draw: start the element |
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
10. A draw was seen and the top is under the target in force → ON, `draw_heating`
11. In the day-zone top-up or the night boost: top at or above the target → OFF, `day_top_up_reached` /
    `night_boost_reached`; else ON, `day_top_up` / `night_boost`, with the hysteresis below the target
12. `top >= comfortMin + hysteresis` → OFF, `temperature_sufficient`
13. Otherwise hold the current state, `hysteresis_zone_maintain_{true,false}`

After the rules, a start while the element is off waits when a [load stagger](#load-stagger) gate
is closed (`load_wait_dishwasher` or `load_wait_main_power`), except `emergency_heating_top_cold`.
So the gates apply to the top-up, the boost and the draw start too.

**Control modes** (`homy/features/control_mode/boiler_controller/set`): `automatic`, `manual_on`,
`manual_off`, `vacation_3d`, `vacation_5d`, `vacation_7d`, `vacation_10d`, `vacation_14d`, `vacation_until`.

`vacation_until` (#1756) is a vacation mode with an end time from the command:
`{"mode": "vacation_until", "until": <epoch ms>}`. The heater is off until `until`, then the mode goes back to
automatic. `until` must be in the future and at most 60 days ahead. Otherwise the command is refused and logged, and the
mode stays. The `away-mode` bot uses it; see [away-mode.md](away-mode.md). A pick of `vacation_until` in Home Assistant
has no `until`, so it is refused.

The highest top the element heats to is what makes `max(t2)` a usable solar-contribution signal: a
day whose top temperature never exceeds it got all of its heat from the immersion heater. That is the
basis of the `boiler-solar-no-contribution` alert. That limit was 50 °C (step 12) until #1911 and is
55 °C (`hotWaterLimit`) since; the alert thresholds moved with it — see
`config/grafana/dashboards/BOILER_CONTROLLER_README.md`. **If `hotWaterLimit` goes up (after a mixing
valve is fitted), move the two solar alert limits up too.**

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
  `marginMinutes` (15) after it: 21:00–22:15 in winter, 22:00–23:15 in summer. A run that is on when
  the hold begins is switched off. The 15 minutes after the zone start allow for drift of the meter
  clock. They are also the stagger: the car starts at the zone start and the element 15 minutes
  later (see [Load stagger](#load-stagger)).
- After the hold, the night boost begins on the next temperature reading (see
  [Evening draw](#evening-draw-top-up-boost-and-start-on-a-draw)). Without `nightBoostTarget` the
  normal rules apply: the element starts if the top is under `comfortMin`, and a run that the hold
  cut off does not resume while the top is between `comfortMin` and `comfortMin + hysteresis`.
- **The floor**: when the top is under `nightTariff.floor` (40 °C), the hold does not apply, and the
  element heats as usual. Once on, it runs until the top reaches the floor plus `hysteresis` (43 °C).
  Without this band the 0.1 K jitter of the reading would switch the contactor every few seconds.
- The safety and emergency rules (steps 3–5) come before the hold, so a cold tank always heats.
- The hold uses the month and time in `nightTariff.timeZone`, never a fixed UTC offset.
- Manual and vacation modes (step 1) are not affected.

**To change the zone table**, edit `nightTariff` in `config/automations/boiler-controller-config.js`.
Each entry of `zones` lists its months (1–12) and the zone `start` and `end` as `HH:MM`. Every month
must be in exactly one entry; a month in no entry has no hold. `start` places the hold and the
top-up; `end` ends the night boost. To turn the hold off, remove `nightTariff`. Then run the tests in
`docker/automations/bots/boiler-controller-night-tariff.test.js`, which read the committed config.
The Home Assistant automation `grid_tariff_by_zone` has the same table for the energy dashboard
(`docs/energy-dashboard.md`); change both together.

### Evening draw: top-up, boost and start on a draw

On 5 of the 10 evenings from 2026-10-26 to 2026-11-04 a big hot-water draw soon after 22:15 emptied
the tank: the top fell from about 49 °C to under 30 °C and `emergency_heating_top_cold` fired. The
element was off, because the top was still in the 47–50 °C band, and it started 5–25 minutes after
the draw began, on `emergency_heating_bottom_cold` (#1911). Three rules fix this:

- **Day-zone top-up** (`dayTopUp`): in the `minutesBeforeHold` (90) minutes before the hold, heat
  the top to `target` (55 °C): 19:30–21:00 in winter, 20:30–22:00 in summer. 200 L from 49 to 55 °C
  takes 30–60 minutes with this element, so the top is about 55 °C when the hold starts. This costs
  day price, about 1.4 kWh an evening (the owner chose it on 2026-11-05). The hold at 21:00 stops a
  top-up that has not finished.
- **Night boost** (`nightBoostTarget`): from the end of the hold (22:15 in winter, 23:15 in summer)
  to the end of the night zone (06:00 / 07:00), heat the top to 55 °C, at night price. So the
  element is running, or the top is at 55 °C, when the evening draw comes, and the tank is full
  again in the morning.
- **Start on a draw** (`drawDropK`, `drawWindowMinutes`): when the bottom reading falls by 3 K within
  10 minutes, the element starts (`draw_heating`) without waiting for the bottom to go under
  `emergencyMin`. It heats until the top reaches the target in force: 55 °C in the top-up and the
  boost, else `comfortMin + hysteresis` (50 °C). It does not start when the top is already at that
  target. The bottom sensor sits inside the lower serpentine, where the cold inflow shows first. A
  new detection needs a new fall of 3 K from the reading that fired the last one. A manual or
  vacation mode clears a draw seen before it.

Details:

- **Hysteresis**: the top-up and the boost stop at the target and start again under
  `target - hysteresis` (52 °C), so the 0.1 K jitter of the reading does not switch the contactor.
  The first start in each window ignores that band: a top of 54 °C when the hold ends still gets
  its boost. After a restart of the bot the window counts as just begun.
- **The night hold still wins**: a draw during the hold does not start the element (the floor rule
  still does under 40 °C). The boost starts at the end of the hold. The #1740 trial is unchanged.
- **Load gates** apply to all three starts, like every automatic start except
  `emergency_heating_top_cold`.
- **Zone change days**: the windows follow the month's zone. On 1 April and 1 November the night
  that began the evening before is read with the new table, so the boost of that one night ends an
  hour late (1 April) or early (1 November).
- **55 °C limit**: there is no thermostatic mixing valve (#1473), so water at the tank top reaches
  the taps unmixed. `hotWaterLimit` (55 °C) caps the targets of all three rules, whatever their own
  values. Do not raise it before a valve is fitted. `maxSafe` (85 °C) and the emergency rules are
  unchanged.
- **Why 3 K in 10 min** (data of 2026-10-20 to 2026-11-05, one-minute means of the bottom reading):
  every fall of 3 K within 10 minutes with the element off was a real draw, after which the bottom
  fell to 39 °C or lower. On the evenings the tank emptied it came 2–51 minutes (on 2026-11-03,
  -04 and -05: 16–20 minutes) before the old start. A 2 K threshold also fired on smaller draws;
  4–6 K or a 5-minute window caught the same draws a little later. No fall was seen from the solar
  pump or after the element stopped.
- **Status reasons** in `automation_status`: `day_top_up`, `day_top_up_reached`, `night_boost`,
  `night_boost_reached`, `draw_heating`.
- Tests: `docker/automations/bots/boiler-controller-evening-draw.test.js`, which read the committed
  config.

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
   is running, and otherwise holds the top between 47 °C and 50 °C, except in the night tariff hold,
   the evening top-up and the night boost (55 °C), and starts early on a draw
4. **Energy tracking:** Power consumption monitored separately via energy meter
5. **Manual override:** Available through Home Assistant for electric heater only

### Load stagger

The night zone is cheap, so several big loads want to start at once. The bot spreads out the
element. Plan for one night (T is the night zone start: 22:00 in winter, 23:00 in summer):

| When | What | How |
|---|---|---|
| T | Car charging starts | By hand (see below) |
| T + 0:15 | Element may start | The night hold margin (`nightTariff.marginMinutes`, 15) |
| T + 3:00 | Dishwasher starts | By hand: the dishwasher's delay timer |
| All night | Heat pump | Runs on its own |

**Two gates.** The element does not **start** when:

- **Dishwasher:** the dishwasher meter showed more than `dishwasherOnW` (10 W) in the last
  `dishwasherHoldMs` (10 min). A cycle has pauses with almost no power. A short pause does not mean
  the cycle is over.
- **House load:** the mean of the main meter readings in the `mainPowerMeanMs` (5 min) up to the newest
  reading is at or above `mainPowerCapW` (6000 W). 6 kW is a choice, because the size of the main breaker is not
  known. A short spike does not block when the mean stays under the cap.

When both apply, the reason is `load_wait_dishwasher`. When only the cap applies, it is
`load_wait_main_power`. The bot decides again when a reading changes a gate, so the element starts
soon after the load is gone.

After a restart the bot starts with the element off, so the gates apply to the first decision too.

**The gates only block a start.** An element that is already on is never switched off by them. The
element itself adds about 2.9 kW to the main power. If the cap could stop it, it would switch on
and off.

**Gated rules** (when the element is off and the rule would switch it on):
`emergency_heating_bottom_cold`, the floor heating inside the night hold,
`comfort_heating_insufficient`, `solar_insufficient_boost_needed`, and any other automatic start.
**Never gated:** `emergency_heating_top_cold` (the real low-top emergency),
`safety_shutoff_overheated`, and the manual and vacation modes.

**Missing data never blocks.** If the newest main power reading is older than `maxLoadInputAgeMs`
(10 min, by the message's `_tz`), the cap is ignored. An old dishwasher reading counts as "not
running". A reading without a number is ignored. Only the start offset still applies.

**Status.** The status message has `load: { mainPowerMeanW, dishwasherRunning, capIgnored }`. The
mean is in whole watts, or `null` when there is no recent reading.

**Hand settings** (homy cannot do these):

- Car charger: homy has no control of it and it has no timer of its own (it has a meter only). Use
  the car's scheduled charging, if it has one, to start at T or later.
- Dishwasher: set its delay timer so it starts at about T + 3:00.

**To change the values**, edit `dishwasherOnW`, `dishwasherHoldMs`, `mainPowerCapW`,
`mainPowerMeanMs` and `maxLoadInputAgeMs` in `config/automations/boiler-controller-config.js`. The
inputs are the topics `dishwasherTopic` (field `p`) and `mainPowerTopic` (field `total_p`). Without
the topics the gates are off. The tests are in
`docker/automations/bots/boiler-controller-load-stagger.test.js`.

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