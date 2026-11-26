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
the hour before the zone (see [Night tariff hold](#night-tariff-hold)). The [evening plan](#evening-plan-1985)
heats only the hot water the coming evening is missing: at night price first, at day price just
before the evening for the rest, and during the baths.
It starts at once when a hot-water draw begins, also in the night tariff hold (#1976). It does not start while the
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
| `hotWaterLimit` | 55 °C | The automatic rules (the plan, the draw rule) never heat the top above this (no mixing valve, #1473) |
| `boostBottomTarget` | 50 °C | `boost` and `manual_on` heat until the bottom is at this (#1976) |
| `boostTopLimit` | 60 °C | `boost` and `manual_on` never heat the top to this (#1976) |
| `eveningPlan` | see [Evening plan](#evening-plan-1985) | Heat only what the coming evening is missing (#1985). It replaces `dayTopUp` and `nightBoostTarget`, which are no longer in the committed config |
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
12. In a plan window (`plan_night`: from the end of the hold to the end of the night zone;
    `plan_day`: from the planned start to the hold): top at or above the window's limit → OFF,
    `plan_night_reached` / `plan_day_reached`; nothing missing (a stopped element: less than
    `startBaths` missing) and the top at or over `comfortMin + hysteresis` → OFF, `plan_night_met` /
    `plan_day_met` (under it: steps 13–14 decide); else ON, `plan_night` / `plan_day`,
    with the hysteresis below the limit. Without the plan: the fixed `dayTopUp` and night boost
    windows of #1911, with the reasons `day_top_up(_reached)` and `night_boost(_reached)`
13. `top >= comfortMin + hysteresis` → OFF, `temperature_sufficient`
14. Otherwise hold the current state, `hysteresis_zone_maintain_{true,false}`

Steps 3-14 are the automatic rules; "the element is on" in them is the real contactor state.
After the rules, a start while the element is off waits when a [load stagger](#load-stagger) gate
is closed (`load_wait_dishwasher` or `load_wait_main_power`), except `emergency_heating_top_cold`.
So the gates apply to the plan and the draw start too.

### Evening plan (#1985)

Fixed targets at fixed times did not match the use. On 5 of 14 evenings from 2026-11-06 to
2026-11-19 the water at the tap fell under 40 °C: on 4 of them the tank held about 3 baths at 21:00
and the evening used 4–7. Use changes by weekday, by season and with the number of people at home.
So the controller now learns the use of each evening and heats only what is missing. A bath is one
shower, 65 L of 40 °C water (see [Baths ready](#baths-ready-1984)).

**The plan of an evening.** The plan is for the evening of the local date, from midnight to
midnight: the night after midnight already heats for the coming evening.

1. **Need** (baths): the value of "Бани довечера" when set; else the mean of the last `sameWeekdays`
   (4) stored evenings on the same weekday within `historyDays` (56); else the season table
   `bathsBySeason`. A history that is missing or broken falls back to the table. If the table is
   broken too, the plan fills the tank. It never falls back to "no heating".
2. **Target** = need + `marginBaths` (1). A back-test over 2024-01 → 2026-11: +1 bath was short on 1
   evening in 5, by more than half a bath on 1 in 7; +1.5 baths on 1 in 7 and 1 in 11.
3. **Shortfall** = target − the baths ready now (the tank model).

**Heating** (only in the automatic mode, and only through the usual rules and gates):

- **Night price first** (`plan_night`): from the end of the hold to the end of the night zone
  (22:15–06:00 in winter), heat while something is missing, up to the top at `nightLimit` (55 °C).
- **Day price only for the rest** (`plan_day`): the model gives the minutes the element needs to
  store what is still missing (with its real power, which falls as the water at the element warms;
  at most what the tank holds with the top at `dayLimit`). The day window opens at
  `eveningStart` (19:30) − these minutes − `startMarginMinutes` (15), so the heating is done when
  the evening baths usually start. Once open, the window stays open until the hold (21:00), so it
  also heats during the first baths.
- **During the baths**: the draw rule (#1976) starts the element on a draw, also in the hold.
- What the tank cannot hold with the top at 55 °C (about 3.5 baths) is heated during the baths:
  then the window opens at 19:30, and the element runs once the top falls under the limit.
- A stopped element starts only when `startBaths` (0.25) or more are missing; a running one runs
  until nothing is missing or the top reaches the limit. When nothing is missing and the top is
  under `comfortMin + hysteresis` (50 °C), the usual comfort band decides, so a comfort run still
  goes on to 50 °C.
- In the open day window each bath makes hot water missing again, so the element heats at day
  price during the first baths too, up to the whole target of the evening.

**Safety.** The plan adds no new path to the element. Its starts go through the same steps as
before: old readings (`input_stale`), `maxSafe`, the night hold, `hotWaterLimit` (the plan limits
are capped by it), and the load gates. Tests check each of them. The modes, the emergency, comfort
and draw rules are unchanged.

**Limit:** the automatic rules stop when the top is at 55 °C. A tank with a hot top and a cold
bottom (after a draw, before the bottom is heated) therefore gets no plan heating until the top
falls; the draw rule or the boost button fill it.

**Measured use.** Each evening from `measureFrom` (18:00) to midnight:

```
used  = stored(18:00) − stored(24:00) + element energy − standbyW × hours
baths = used / (65 L × 1.163 × (40 − cold) / 1000)
```

`stored` is the energy of the gradual profile above the cold water; the cold water is the month's
value of `coldWaterByMonth`; `standbyW` is 40 W. The element energy is the `tot` counter (kWh) of
the boiler meter (`boilerMeterTopic`), or, without fresh meter readings, the model's element power
for each minute the element runs. The result is stored per date in the persistent cache
(`eveningBaths`), so it is kept across restarts; evenings older than `historyDays` + 14 days are
dropped. An evening is not stored when the bot started after 18:05, a minute check was missed by
more than 5 min (a restart), the readings are old at 18:00 or at midnight, or the result is out of
range (under −0.5 or over `maxBaths`). When the flow meter on the cold inlet comes, its litres can
replace this balance.

**"Бани довечера"** (Home Assistant number on the boiler device, 0–10 in steps of 0.5): a value
replaces the need of this evening. The controller keeps it in the persistent cache with its date,
publishes it retained on `homy/features/number/boiler_evening_baths/status`, and clears it at
midnight (the number then shows unknown). 0 means no baths tonight (nobody at home); the margin
still keeps one bath ready. A value out of
range is refused and the old one stays.

**Status** (`plan` in `homy/automation/boiler_controller/status`):

| field | meaning |
|---|---|
| `date` | the evening the plan is for |
| `need`, `needSource` | baths; `override`, `history`, `season` or `none` |
| `marginBaths`, `targetBaths` | the margin and need + margin |
| `bathsReady`, `capacityBaths` | baths in the tank now, and with the top at the day limit all the way down |
| `shortfallBaths` | target − ready, at least 0 |
| `heatMinutes` | the model's minutes to store the day part of the shortfall |
| `nextStart` | ms time the plan lets the element heat next: now in a window, the end of the hold, or the planned day start; null when nothing is missing |
| `override` | the "Бани довечера" value for this evening, or null |
| `lastEvening` | the last stored evening: `{ date, baths, elementKwh, energySource }` (since the last start) |

The plan fields are null while the boiler readings are old or missing.

**Config** (`eveningPlan` in `boiler-controller-config.js`, each with a comment): `marginBaths` 1,
`eveningStart` '19:30', `startMarginMinutes` 15, `nightLimit` 55, `dayLimit` 55, `startBaths` 0.25,
`measureFrom` '18:00', `standbyW` 40, `boilerMeterTopic`, `sameWeekdays` 4, `historyDays` 56,
`maxBaths` 15, `bathsBySeason`, `overrideSetTopic`, `overrideStatusTopic`, `overrideMaxBaths` 10.
The plan needs `nightTariff`; without it, or without both limits, the plan is off.

Season table (mean baths per evening 18:00–24:00, 2023-11 → 2026-11):

| season | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| winter (Nov–Mar) | 2.4 | 2.5 | 2.6 | 2.5 | 1.8 | 1.5 | 2.8 |
| spring, autumn | 2.8 | 2.8 | 2.8 | 2.8 | 2.0 | 2.1 | 3.5 |
| summer (Jun–Aug) | 2.1 | 2.0 | 2.2 | 1.9 | 1.3 | 1.7 | 2.2 |

The table is only the start: recent weeks may be higher (Mon–Thu in November 2026: 3.5), and the
learned mean follows a change by a quarter each week. Weekend daytime baths are not in the evening
need; the day-price heating covers them before the evening.

Code: `docker/automations/lib/boiler-plan.js` (balance, need, minutes) and the bot. Tests:
`lib/boiler-plan.test.js` and `bots/boiler-controller-evening-plan.test.js`, which read the
committed config.

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
- After the hold, the plan's night heating begins when the coming evening is missing hot water (see
  [Evening plan](#evening-plan-1985)). Without the plan, the night boost of #1911 begins (see
  [Evening draw](#evening-draw-top-up-boost-and-start-on-a-draw)). Without either, the
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

The day-zone top-up and the night boost below run only without the [evening plan](#evening-plan-1985),
which replaced them in the committed config (#1985). The start on a draw is unchanged.

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
  within `drawLatchMinutes` (30) is dropped, for example when the load gates held it back. So in the
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
  load gates apply. Other starts still wait for the end of the hold; the night boost starts then.
- **Load gates** apply to all three starts, like every automatic start except
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

### Baths ready (#1984)

The status says how much hot water the tank holds, in baths. A **bath** is one shower: `bathLitres`
(65 L) of water at `bathTempC` (40 °C) at the tap. Single draws in three years of one-minute history
(2023-11 to 2026-11) were mostly 45–95 L (the middle half). One bath is
`65 × 1.163 × (40 − cold) / 1000` kWh: about 2.0 kWh in winter (cold water 12–15 °C) and 1.3 kWh in
summer (23 °C). These numbers are only computed and published: no heating rule, target or hold uses
them, and they never send a relay command.

**Model** (`docker/automations/lib/boiler-tank.js`, the "gradual profile"):

1. The tank (`tankModel`): 184 L in 16 horizontal layers of 11.5 L over 1157 mm of water. The outlet
   is in layer 14 (the layer above it is not drawn off), the element in layer 1, the bottom sensor
   371 mm and the top sensor 915 mm above the inside bottom.
2. Profile: a straight line through the two sensor readings, extended down to the bottom (never
   colder than the cold water and never hotter than the hotter reading); above the top sensor, the
   top reading.
3. Usable water: a draw is simulated in 6 L steps until the outlet layer is under 40 °C. Each step
   counts `6 × (outlet − cold) / (40 − cold)` litres at the tap. In each step the water moves up
   towards the outlet, and the cold water mixes into the lowest layers (layer j takes the share
   `exp(-j / 1.07)`, fitted from the data).
4. Minutes to one more bath: every 5 minutes the element adds `power × 5 min` to its layer, and
   any layer warmer than the one above mixes with it (warm water rises). This repeats until the
   usable water has grown by one bath; no number after 10 h, or when the top layer reaches 75 °C.
5. Element power (`elementPowerByTempKw`): the mean power while the controller asks for heat, by the
   water temperature at the element. The element cuts out and cycles by itself as the water warms:
   under 30 °C 2.6 kW, 30–35 °C 2.1 kW, 35–40 °C 1.55 kW, 40–45 °C 1.05 kW, over 45 °C 0.75 kW.
6. Cold water (`coldWaterByMonth`, January first, °C): 11.6, 9.8, 13.3, 12.9, 17.2, 19.9, 23.0, 23.9,
   19.1, 17.1, 14.6, 13.1. This is the lowest bottom reading of that month over three years; the
   month is read on the `timeZone` wall clock.

Examples (cold water 13 °C):

| top °C | bottom °C | usable | baths | one more bath with the element on |
|---|---|---|---|---|
| 65 | 10 | 104 L | 1.6 | ~85 min |
| 55 | 25 | 90 L | 1.4 | ~75 min |
| 55 | 45 | 172 L | 2.6 | ~125 min |
| 55 | 55 | 229 L | 3.5 | ~160 min |
| 60 | 60 | 262 L | 4.0 | ~160 min |

So one more bath takes about 60–95 min with a cold bottom and 2–2.5 h with a warm bottom. Boost does
not make the element stronger, it only starts it now: the boost number is the same as the number
with the element on.

**Status fields** on `homy/automation/boiler_controller/status`:

| field | meaning |
|---|---|
| `bathsReady` | usable litres ÷ `bathLitres`, one decimal |
| `usableLitres` | litres of 40 °C water at the tap, whole litres |
| `minutesToNextBath` | minutes to one more bath while the element runs; `null` when it does not run |
| `boostMinutesToNextBath` | the same if a boost started the element now; `null` while the element runs, or when a boost would be refused (top at `boostTopLimit`, or bottom at `boostBottomTarget`) |
| `bathInputs` | `{ top, bottom, cold }`: the values the numbers come from |
| `bathText` | the Bulgarian sentence of the Home Assistant sensor |

With old (see [Old input](#old-input)) or missing top or bottom readings, all these fields are `null`:
never an old number. The numbers go out with every status: on each decision change and with the
15-minute heartbeat, so they can be up to 15 minutes old. `automation-events-processor` does not write
them to InfluxDB: it reads only its own named fields.

**Limits.**

- Compared with a full 16-layer model fitted to the same history (sensor error 0.8–2.8 K by month),
  the gradual profile is off by 9 L (0.14 baths) on the mean, and says 8 L more on average.
- Only two sensors: the shape between and below them is a guess. The bottom sensor sits in the
  solar coil; while the solar pump runs it reads the coil, so the count is less exact then.
- The cold water table is the lowest bottom reading of a month; the real cold water may be a little
  colder, which gives a little less water than the model says.
- The minutes assume nothing is drawn while the element heats, and the solar coil adds nothing.
- A flow meter on the cold inlet is planned. It can give the drawn litres instead of this estimate;
  `bathEstimate` in `lib/boiler-tank.js` is the one function to change for that.

Tests: `docker/automations/lib/boiler-tank.test.js` (the table above, the sentence) and
`docker/automations/bots/boiler-controller-baths.test.js` (the status, old and missing readings).

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
- **Бани довечера** (number, #1985): the baths of this evening, set by hand; it replaces the learned
  need for this evening and clears itself at midnight. See [Evening plan](#evening-plan-1985).
- **Режим на управление** (select): the controller's mode, see [Control modes](#control-modes).
- **Загрей целия бойлер** (button, "Загрей до 55 °C" before #1976): sends `{"mode": "boost"}` to the mode
  topic. The entity id stays `button.boiler_boost`.
- **Готова вода** (sensor, #1984): `bathText` from the status, for example "Готови: 2 бани. С „Загрей
  целия бойлер“ още една след ~35 мин." (element off, a boost would start it), "Готови: 1,5 бани. Още
  една след ~40 мин." (element on) or "Готови: 3,5 бани." (element off, a boost would be refused). It
  is unknown while the readings are old or missing. Its attributes are the numbers; see
  [Baths ready](#baths-ready-1984).
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
   and the evening plan (up to 55 °C), and starts early on a draw
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
ON reading and then the OFF reading are both the bot's own. When both commands ran between two polls,
a reading of the newest command's state 10 s or more after it answers them all. Until then the rules see the
command's state, so an old reading from just before the write does not count. A contactor that still
differs after 60 s gets the command again (a lost write), at most once a minute. No outside change is
answered with a command against it, so the bot and someone else cannot switch back and forth.

**Outside ON** (a change to ON that the bot did not send): a manual request, reason `external_on`. The
element stays on until the top reaches the stop target in force: `comfortMin + hysteresis` (50 °C), or
the limit of the plan window in force (55 °C; without the plan: the day top-up or night boost window). It stays on at most `externalOnMaxMs`
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
