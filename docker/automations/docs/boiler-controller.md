# Boiler Controller Documentation

## Overview

The boiler system consists of an Eldom FV20060S21 cylindrical water heater (184 L net, height: 143cm) with dual heating capabilities:
- Electric heater controlled by automation
- Solar heater system (always active when conditions permit)

## Hardware Configuration

### Boiler Specifications
- **Model:** Eldom FV20060S21 (rating plate read on 2026-11-19)
- **Type:** Cylindrical water heater
- **Height:** 143cm
- **Volume:** 184L net
- **Electric heater:** 3kW single phase
- **Location:** Service room (Сервизно)

### Temperature Sensors
- **Bottom sensor:** about 47cm from base, in the sensor socket (port 8) of the lower port group.
  The cold inlet is at 21cm and the solar coil S1 runs from 26cm to 117cm, so the solar pump and the
  cold water of a draw move it first and fast.
- **Top sensor:** h=106.5cm from base, port 11 (the unused coil S2 inlet port)

### Control Hardware
- **Electric heater contactor:** Relay bit 14 on `/modbus/dry-switches/relays00-15`
- **Solar circulation pump:** Controlled by external solar heater controller
- **Energy meter:** Connected to `/modbus/secondary/boiler/reading`
- **External solar controller:** Connected to `/modbus/monitoring/solar_heater` (monitoring only; `sr04-sync-clock` sets its clock and nothing else)

## MQTT Topics

### Temperature Monitoring
```
homy/features/sensor/temperature_boiler_low/status     # Bottom sensor (about 47cm, port 8)
homy/features/sensor/temperature_boiler_high/status    # Top sensor (106.5cm, port 11)
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
It starts at once when a hot-water draw begins, also in the night tariff hold (#1976). It does not start while
phase A, the element's phase, has no room for it (see [Load stagger](#load-stagger), #1987). The legacy `boilerOnSchedule`
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
| `hotWaterLimit` | 55 °C | The automatic top-up, night boost and draw rules never heat the top above this (no mixing valve, #1473) |
| `boostBottomTarget` | 50 °C | `boost` and `manual_on` heat until the bottom is at this (#1976) |
| `boostTopLimit` | 60 °C | `boost` and `manual_on` never heat the top to this (#1976) |
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
2. A mode (see [Control modes](#control-modes)): `boost` → ON, `manual_boost`, until the bottom reaches
   `boostBottomTarget` or the top `boostTopLimit` (then `automatic` and the rules below); `manual_on` → ON
   with the same limits;
   `manual_off` / `vacation_*` → OFF
3. Boiler top or bottom temperature older than `maxInputAgeMs` → OFF, `input_stale` (see
   [Old input](#old-input))
4. `top >= maxSafe` → OFF, `safety_shutoff_overheated`
5. `top < emergencyMin` → ON, `emergency_heating_top_cold`
6. `bottom < emergencyMin` → ON, `emergency_heating_bottom_cold`
7. In the night tariff hold **and** `top >= nightTariff.floor` (plus `hysteresis` while the element is on):
   a draw was seen and the top is under the draw target → ON, `draw_heating` (#1976); else OFF,
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
is closed (`load_wait_phase_a`), except `emergency_heating_top_cold`.
So the gate applies to the top-up, the boost and the draw start too.

### Control modes

The topic is `homy/features/control_mode/boiler_controller/set`. Modes: `automatic`, `boost`,
`manual_on`, `manual_off`, `vacation_3d`, `vacation_5d`, `vacation_7d`, `vacation_10d`, `vacation_14d`, `vacation_until`.

`boost` (#1912) is the Home Assistant button **Загрей целия бойлер**. It heats the whole tank (#1976): it starts
the element at once, also in the night hold and with a load gate closed, reason `manual_boost`, and runs until
the **bottom** reaches `boostBottomTarget` (50 °C). It stops early when the **top** reaches `boostTopLimit`
(60 °C) or after `boostDurationMs` (2 h). Then the mode goes back to `automatic` by itself. `maxSafe` and old
input (`input_stale`) stop it earlier; old input does not end the mode, so it heats again when the readings
come back within the 2 h. A second press while it runs starts the 2 h again. The mode select shows `boost`
while it runs. A `boost` is refused (#1975, #1976) when the top is already at or above `boostTopLimit`
(`top_at_limit`) or the bottom at or above `boostBottomTarget` (`bottom_at_target`): the boost would end at
once, so the mode and its end time stay as they were, and `lastCommand` says why (see below).

Why the bottom: until #1976 boost stopped at 55 °C at the top. On 2026-11-19 at 19:00 the top was 56.2 °C and
the bottom 43 °C, so every boost ended at once though the lower half of the tank was cold. The same evening
the element ran by hand from 20:20 to 22:45 (5.1 kWh): the bottom rose from 41 °C to 54 °C and the top stayed
over 52 °C through the baths. The top may reach up to 60 °C in a boost, above the 55 °C of the automatic rules
(there is no mixing valve, #1473); a person chooses it, and 60 °C is the hard cap.

`manual_on` keeps the mode for `manualOverrideExpiry` (24 h) and uses the same two limits (#1976): it heats
while the bottom is under `boostBottomTarget` (50 °C), and goes OFF when the bottom reaches it or the top
reaches `boostTopLimit` (60 °C), reason `manual_on_limit_reached (expires: …)`. Once off, it starts again when
the bottom is under `boostBottomTarget - hysteresis` (47 °C) and the top under `boostTopLimit - hysteresis`
(57 °C). A missing reading does not block it. `top >= maxSafe` is OFF, `safety_shutoff_overheated`. As before
(#1743), old input does not stop `manual_on`; the limits then use the last reading.

**The bottom sensor sits inside the solar coil** (see [Temperature Sensors](#temperature-sensors)). While the
solar pump runs, it reads the coil, which is then warmer than the water around it. So a boost may end early
and `manual_on` may pause on a sunny day. That is the safe side: the top limit still holds.

`vacation_until` (#1756) is a vacation mode with an end time from the command:
`{"mode": "vacation_until", "until": <epoch ms>}`. The heater is off until `until`, then the mode goes back to
automatic. `until` must be in the future and at most 60 days ahead. Otherwise the command is refused and logged, and the
mode stays. The `away-mode` bot uses it; see [away-mode.md](away-mode.md). A pick of `vacation_until` in Home Assistant
has no `until`, so it is refused.

#### Command result: `lastCommand`

Every mode command gets a result (#1975). It goes out with the mode status on
`homy/features/control_mode/boiler_controller/status`, so any client that sends a command can read it:

```json
{
  "mode": "automatic",
  "manualOverrideExpires": null,
  "lastCommand": {"mode": "boost", "result": "refused", "reason": "bottom_at_target", "top": 58.1, "bottom": 50.4, "limit": 60, "bottomTarget": 50, "at": 1795633440000}
}
```

- `mode`: the mode in the command (cut to 64 characters; `null` when the command had no mode text).
- `result`: `applied` (the mode was set) or `refused` (the mode and its end time stay as they were).
- `reason`:
  - `ok`: applied, nothing to add.
  - `top_at_limit`: the top is at or above `boostTopLimit`. With `refused`, a `boost`. With `applied`, a
    `manual_on`: the mode is set, but the element heats only once the top falls under the limit.
  - `bottom_at_target`: the bottom is at or above `boostBottomTarget` (and the top is under its limit). With
    `refused`, a `boost`. With `applied`, a `manual_on` that heats only once the bottom falls.
  - `invalid_until`: refused, a `vacation_until` without a valid `until`.
  - `unknown_mode`: refused, a mode that is not in the list above.
- `top` and `bottom`: the last top and bottom readings in °C when the command came (`null` before the first
  one); `limit`: `boostTopLimit` (it was `hotWaterLimit` before #1976); `bottomTarget`: `boostBottomTarget`.
- `at`: the time of the command, in ms.

The result stays in the status until the next command; later statuses repeat it. It is kept in memory only, so
after a restart it is `null` until the next command.

The highest top the element heats to is what makes `max(t2)` a usable solar-contribution signal: a
day whose top temperature never exceeds it got all of its heat from the immersion heater. That is the
basis of the `boiler-solar-no-contribution` alert. That limit was 50 °C (step 12) until #1911 and is
55 °C (`hotWaterLimit`) since; the alert thresholds moved with it — see
`config/grafana/dashboards/BOILER_CONTROLLER_README.md`. **If `hotWaterLimit` goes up (after a mixing
valve is fitted), move the two solar alert limits up too.** A `boost` or `manual_on` can heat the top up to
`boostTopLimit` (60 °C) since #1976, so on a day with one of them `boiler-solar-no-contribution` may stay
quiet though the sun gave nothing. Those are rare, manual days.

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
  the top to `target` (55 °C): 19:30–21:00 in winter, 20:30–22:00 in summer. 184 L from 49 to 55 °C
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
  within `drawLatchMinutes` (30) is dropped, for example when the load gate held it back. So in the
  day zone the rule starts the element only while the top is under 50 °C (before, it waited for 47 °C
  or a bottom under 30 °C). The bottom sensor sits low in the tank, near the cold inlet, where the cold inflow
  shows first. A new detection needs a new fall of 3 K from the reading that fired the last one. A
  manual or vacation mode clears a draw seen before it.

Details:

- **Hysteresis**: the top-up and the boost stop at the target and start again under
  `target - hysteresis` (52 °C), so the 0.1 K jitter of the reading does not switch the contactor.
  The first start in each window ignores that band: a top of 54 °C when the hold ends still gets
  its boost. After a restart of the bot the window counts as just begun.
- **A draw beats the night hold** (#1976): the evening baths fall in the hold (21:00–22:15 in winter).
  Before #1976 a draw in the hold did not start the element until the top fell under the 40 °C floor;
  on 2026-11-16 the element gave 0 kWh from 21:00 to 22:00 and the top fell to 19.8 °C. Now a draw in the
  hold starts the element and heats the top to the draw target (`comfortMin + hysteresis`, 50 °C), then
  the hold applies again. A draw seen with the top still at the target waits, as outside the hold. The
  phase A gate applies. Other starts still wait for the end of the hold; the night boost starts then.
- **The load gate** applies to all three starts, like every automatic start except
  `emergency_heating_top_cold`.
- **Zone change days**: the windows follow the month's zone. On 1 April and 1 November the night
  that began the evening before is read with the new table, so the boost of that one night ends an
  hour late (1 April) or early (1 November).
- **55 °C limit**: there is no thermostatic mixing valve (#1473), so water at the tank top reaches
  the taps unmixed. `hotWaterLimit` (55 °C) caps the targets of all three rules, whatever their own
  values. Do not raise it before a valve is fitted. Only `boost` and `manual_on`, which a person
  starts, may heat the top up to `boostTopLimit` (60 °C); the owner chose this on 2026-11-19 (#1976). `maxSafe` (85 °C) and the emergency rules are
  unchanged.
- **Why 3 K in 10 min** (data of 2026-10-20 to 2026-11-05, one-minute means of the bottom reading):
  every fall of 3 K within 10 minutes with the element off was a real draw, after which the bottom
  fell to 39 °C or lower. On the evenings the tank emptied it came 2–51 minutes (on 2026-11-03,
  -04 and -05: 16–20 minutes) before the old start. A 2 K threshold also fired on smaller draws;
  4–6 K or a 5-minute window caught the same draws a little later. No fall was seen from the solar
  pump or after the element stopped.
- **Status reasons** in `automation_status`: `day_top_up`, `day_top_up_reached`, `night_boost`,
  `night_boost_reached`, `draw_heating`.
- Tests: `docker/automations/bots/boiler-controller-evening-draw.test.js` and
  `boiler-controller-whole-tank.test.js` (#1976), which read the committed config.

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
- **Загрей целия бойлер** (button, "Загрей до 55 °C" before #1976): sends `{"mode": "boost"}` to the mode
  topic. The entity id stays `button.boiler_boost`.
- **Последна команда** (sensor, #1975): the `lastCommand` result as a short Bulgarian sentence, for example
  "Загряването не започна: долу е 50.4 °C, целта е 50 °C." Its attributes are the fields of `lastCommand`.
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
| Any time in the night zone | Dishwasher | By hand: the dishwasher's delay timer (it is on another phase) |
| All night | Heat pump | Runs on its own |

**The limit is per phase** (#1987). The house has a 3-pole 32 A breaker in front of its busbar, so
each phase may carry 32 A. There is no known limit for the whole house. The element is on
**phase A**; the dishwasher is on **phase C**. So the dishwasher does not change the room on phase A,
and holding the element back for it only cost hot water.

Data of 12 months (2025-11-20 to 2026-11-20, 1-minute means of the main meter):

- The highest 1-minute phase currents: A 29.7 A, B 32.1 A, C 23.5 A.
- While the element and the dishwasher ran together: phase A at most 28.0 A, phase C at most 21.6 A.
- The element never pushed phase A to 32 A. In the 9 minutes phase A was at 28.8 A (90 %) or more,
  the element had started while phase A was low, and the oven came on later. A start gate cannot
  catch that case, and it stayed under the limit.

The 565 element starts of that year, with each gate checked on the 5–10 minutes before the start, as
if it had been live all year (the wait is the time until the gate opens):

| Gate | Starts held | Wait in all | Median / longest wait | 18:00–23:00 |
|---|---|---|---|---|
| Dishwasher (removed) | 95 | 86.2 h | 54 / 169 min | 42 starts, 42.0 h |
| House mean 6 kW (removed) | 7 | 0.5 h | 3 / 11 min | 5 starts, 0.5 h |
| Both together (before #1987) | 98 | 86.4 h | 53 / 169 min | 43 starts, 42.1 h |
| **Phase A: mean + 12.5 A ≥ 32 A** | **0** | 0 | – | 0 |
| Phase A, at 28.8 A (90 %) | 1 | 1 min | – | 1 |

An evening wait was about 59 minutes on average. At about 2 kW that is about 2 kWh, close to one
shower.

**One gate: phase A.** The element does not **start** while the mean of phase A's current (`ac` on
the main meter reading) over `phaseMeanMs` (5 min) up to the newest reading, plus `elementCurrentA`
(12.5 A, the element's own current), is at or over `phaseLimitA` (32 A). That is a mean of 19.5 A or
more. The reason is `load_wait_phase_a`. A short spike does not block when the mean stays under the
limit. The bot decides again when a reading opens or closes the gate, so the element starts soon
after the load falls.

**The gate only blocks a start.** An element that is on is never switched off by it, whoever
turned it on: the bot reads the real contactor state (#1912, see [Contactor feedback](#contactor-feedback)). The
element itself adds about 12.5 A (2.9 kW) to phase A. If the gate could stop it, it would switch on
and off.

**Gated rules** (when the element is off and the rule would switch it on):
`emergency_heating_bottom_cold`, the floor heating inside the night hold,
`comfort_heating_insufficient`, `solar_insufficient_boost_needed`, `draw_heating`, the day top-up,
the night boost, and any other automatic start.
**Never gated:** `emergency_heating_top_cold` (the real low-top emergency),
`safety_shutoff_overheated`, boost, and the manual and vacation modes. The safety checks
(`maxSafe`, old temperatures, the top limits) come before the gate.

**Missing data never blocks.** If there is no phase reading, or the newest is older than
`maxLoadInputAgeMs` (10 min, by the message's `_tz`), the gate is ignored (`capIgnored: true`). A
reading without a number in `ac` is ignored. Only the start offset still applies.

**Status.** The status message has `load: { phaseAMeanA, capIgnored }`. The mean is in amperes with
one decimal, or `null` when there is no reading in the window.

**Hand settings** (homy cannot do these):

- Car charger: homy has no control of it and it has no timer of its own (it has a meter only). Use
  the car's scheduled charging, if it has one, to start at T or later.
- Dishwasher: it may start any time in the night zone. It is on phase C, so it does not hold back
  the element.

**To change the values**, edit `phaseLimitA`, `elementCurrentA`, `phaseMeanMs` and
`maxLoadInputAgeMs` in `config/automations/boiler-controller-config.js`. The input is the topic
`mainMeterTopic` (field `ac`, phase A's current in A). Without the topic the gate is off. The tests
are in `docker/automations/bots/boiler-controller-load-stagger.test.js`.

### Contactor feedback

On 2026-11-05 the contactor was turned on from the Home Assistant switch while hot water was being
used. The bot took its own last command ("off") as the state, so 23 minutes later the dishwasher gate
(removed in #1987) "held back a start" and switched the element off, while the tank emptied (#1912). Since then the bot
reads `contactorStatusTopic` and uses it as the state of the element.

**Own commands.** Each command the bot sends comes back on the status topic. A change that matches a
command sent in the last `commandConfirmMs` (60 s), and not answered by an earlier reading, is the
bot's own. A reading answers that command and all older ones, so after a quick ON then OFF the late
ON reading and then the OFF reading are both the bot's own. When both commands ran between two polls,
a reading of the newest command's state 10 s or more after it answers them all. Until then the rules see the
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

See `docs/water_system_spec.md` for the full port table and coil data.
