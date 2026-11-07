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
homy/features/relay/service_boiler_contactor/status    # Electric heater status (the controller reads it, #1912)
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
It starts at once when a hot-water draw begins. It does not start while the
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
| `drawLatchMinutes` | 30 min (default) | A draw that has not started the element in this time is dropped |
| `maxInputAgeMs` | 10 min (default) | Boiler top/bottom temperature older than this ⇒ OFF, `input_stale` |
| `contactorStatusTopic` | `homy/features/relay/service_boiler_contactor/status` | The real contactor state; see [Contactor feedback](#contactor-feedback). Without it the bot takes its own last command as the state |
| `externalOnMaxMs` | 2 h | An ON the bot did not send is kept at most this long |
| `externalOffHoldMs` | 30 min | After an OFF the bot did not send, no start for this long |
| `boostDurationMs` | 2 h | The longest `boost` |
| `commandConfirmMs` | 60 s (default) | A status that matches a command sent this recently is that command coming back |
| `manualOverrideExpiry` | 24 h | Default expiry for `manual_on`/`manual_off`; an object payload's `duration` overrides it. **Vacation modes do not use it** — they expire after `days × 24 − 6` hours (66 / 114 / 162 / 234 / 330 h) |

**Decision order** (first match wins, `makeDecision()` in the bot):

1. An outside OFF in the last `externalOffHoldMs` → OFF, `external_off`; an outside ON →
   ON, `external_on`, until it ends (see [Contactor feedback](#contactor-feedback))
2. A mode (see [Control modes](#control-modes)): `boost` → ON, `manual_boost`, until the top reaches
   `hotWaterLimit` (then `automatic` and the rules below); `manual_on` → ON with the limits;
   `manual_off` / `vacation_*` → OFF
3. Boiler top or bottom temperature older than `maxInputAgeMs` → OFF, `input_stale` (see
   [Old input](#old-input))
4. `top >= maxSafe` → OFF, `safety_shutoff_overheated`
5. `top < emergencyMin` → ON, `emergency_heating_top_cold`
6. `bottom < emergencyMin` → ON, `emergency_heating_bottom_cold`
7. In the night tariff hold **and** `top >= nightTariff.floor` (plus `hysteresis` while the element is on) → OFF,
   `night_tariff_hold`
8. `top < comfortMin` → ON, `comfort_heating_insufficient`
9. `collector - top >= solarAdvantageMin` **and** the pump is circulating → OFF, `solar_priority_available`
10. `collector - top <= solarDisadvantageMax` → ON, `solar_insufficient_boost_needed`
11. A draw was seen and the top is under the target in force → ON, `draw_heating`
12. In the day-zone top-up or the night boost: top at or above the target → OFF, `day_top_up_reached` /
    `night_boost_reached`; else ON, `day_top_up` / `night_boost`, with the hysteresis below the target
13. `top >= comfortMin + hysteresis` → OFF, `temperature_sufficient`
14. Otherwise hold the current state, `hysteresis_zone_maintain_{true,false}`

Steps 3-14 are the automatic rules; "the element is on" in them is the real contactor state.
After the rules, a start while the element is off waits when a [load stagger](#load-stagger) gate
is closed (`load_wait_dishwasher` or `load_wait_main_power`), except `emergency_heating_top_cold`.
So the gates apply to the top-up, the boost and the draw start too.

### Control modes

The topic is `homy/features/control_mode/boiler_controller/set`. Modes: `automatic`, `boost`,
`manual_on`, `manual_off`, `vacation_3d`, `vacation_5d`, `vacation_7d`, `vacation_10d`, `vacation_14d`, `vacation_until`.

`boost` (#1912) is the Home Assistant button **Загрей до 55 °C**. It starts the element at once, also in the night
hold and with a load gate closed, reason `manual_boost`. It stops when the top reaches `hotWaterLimit` (55 °C) or
after `boostDurationMs` (2 h), whichever is first, and the mode then goes back to `automatic` by itself. `maxSafe`
and old input (`input_stale`) stop it earlier; old input does not end the mode, so it heats again when the
readings come back within the 2 h. A second press while it runs starts the 2 h again. The mode select shows
`boost` while it runs.

`manual_on` keeps the mode for `manualOverrideExpiry` (24 h), but no longer heats without a limit (#1912): at
`hotWaterLimit` (55 °C) the element goes OFF, reason `manual_on_limit_reached (expires: …)`, and it starts
again when the top falls under `hotWaterLimit - hysteresis` (52 °C). `top >= maxSafe` is OFF,
`safety_shutoff_overheated`. As before (#1743), old input does not stop `manual_on`; the limits then use the
last reading.

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
  boost, else `comfortMin + hysteresis` (50 °C). A draw seen while the top is still at that target
  waits: the element starts when the top falls under it. A draw that has not started the element
  within `drawLatchMinutes` (30) is dropped, for example when the load gates held it back. So in the
  day zone the rule starts the element only while the top is under 50 °C (before, it waited for 47 °C
  or a bottom under 30 °C). The bottom sensor sits inside the lower serpentine, where the cold inflow
  shows first. A new detection needs a new fall of 3 K from the reading that fired the last one. A
  manual or vacation mode clears a draw seen before it.

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
- **Режим на управление** (select): the controller's mode, see [Control modes](#control-modes).
- **Загрей до 55 °C** (button): sends `{"mode": "boost"}` to the mode topic.
- **Контактор**: read only since #1912 (a binary sensor; it was a switch). The switch started the
  element without the controller, and the controller then stopped it. The empty retained config of
  `haBoilerContactorSwitchRemoved` (`config/automations/config.js`) removes the old switch entity.
  To heat by hand, use the button or the mode.

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

**The gates only block a start.** An element that is on is never switched off by them, whoever
turned it on: the bot reads the real contactor state (#1912, see [Contactor feedback](#contactor-feedback)). The
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

### Contactor feedback

On 2026-11-05 the contactor was turned on from the Home Assistant switch while hot water was being
used. The bot took its own last command ("off") as the state, so 23 minutes later the dishwasher gate
"held back a start" and switched the element off, while the tank emptied (#1912). Since then the bot
reads `contactorStatusTopic` and uses it as the state of the element.

**Own commands.** Each command the bot sends comes back on the status topic. A change that matches a
command sent in the last `commandConfirmMs` (60 s), and not answered by an earlier reading, is the
bot's own. A reading answers that command and all older ones, so after a quick ON then OFF the late
ON reading and then the OFF reading are both the bot's own. Until then the rules see the
command's state, so an old reading from just before the write does not count. A contactor that still
differs after 60 s gets the command again (a lost write), at most once a minute. No outside change is
answered with a command against it, so the bot and someone else cannot switch back and forth.

**Outside ON** (a change to ON that the bot did not send): a manual request, reason `external_on`. The
element stays on until the top reaches the stop target in force: `comfortMin + hysteresis` (50 °C), or
the target of the day top-up or night boost window (55 °C). It stays on at most `externalOnMaxMs`
(2 h); after that the usual rules decide, for an element that is on. Only `maxSafe`
(`safety_shutoff_overheated`), `hotWaterLimit` (`hot_water_limit`, only if a target were above it) and
old input (`input_stale`) stop it earlier. **It is kept in the night hold (#1740) and with a load gate
closed**: the hold and the gates are rules for the bot's own starts. It is also kept over a mode such
as `manual_off` set before the ON. The start time is kept over a restart (`externalOnSince` in the
state file).

**Outside OFF**: reason `external_off`. No rule and no mode starts the element again for
`externalOffHoldMs` (30 min); then the usual rules decide. Why 30 min: with the Home Assistant
contactor read only, an outside OFF is rare and most likely meant (a person at the relay module, or a
script), so it gets some time. But a reset of the relay module also turns the outputs off, and then
the tank must not wait long. 30 min is short next to the 2 h of an outside ON and the hours between
the evening and night heating windows.

**A mode command ends both** (the button, the select, away mode): it is newer than the outside change.

**Restart.** The status is retained, so it arrives at once after a start. The bot sends no command
before it knows the contactor state, or before `commandConfirmMs` has passed without one (then it
decides as before, on its own state). A running element after a restart counts as the bot's own (the
usual rules continue with it on), unless an outside ON started less than `externalOnMaxMs` before;
that one is kept with its first start time.

**Status.** `homy/automation/boiler_controller/status` has `heaterState` (the real state: the
contactor, or a command not yet confirmed), `contactorState` (the last status, `null` before the
first) and `decision` (the bot's own last decision). The tests are in
`docker/automations/bots/boiler-controller-load-stagger.test.js`.

### Old input

When the top or the bottom temperature is older than `maxInputAgeMs` (10 min by default), the element
is OFF with reason `input_stale` (#1743), and the bot posts one Telegram message through
`telegram-bridge`. When both temperatures arrive again it posts one "back" message and decides as
usual. The age is checked on every reading and every 30 s, and taken from the message's own `_tz`, so
old retained values after a start count as old; a temperature not seen yet counts from the start.
The 15-minute heartbeat also decides again, so a manual mode expires on time during an outage. `manual_on`,
`manual_off` and the vacation modes still win, so a person can force heating during a long outage;
`boost` and an outside ON stop on old input. The safe state
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
- **HA discovery:** `config/automations/ha_discovery.js` — contactor (read-only binary sensor), boost button, control-mode select, temperature
  sensors (boiler low/high, solar panel, service room)

## Safety Features

- **Timeout protection:** Inherent in solar controller
- **Temperature monitoring:** Multiple sensors for system health
- **Manual override:** Available for emergency situations
- **Power monitoring:** Heating status detection via power consumption