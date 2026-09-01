# InfluxDB Schema Documentation

This document provides comprehensive documentation of all data stored in the InfluxDB time-series database.

## Database Overview

- **Database**: `homy`
- **Host**: localhost:8086
- **Access**: Credentials managed through Docker secrets
- **Retention**: Historical data available back to 2022
- **Resolution**: Sub-second to minute-level intervals depending on data source

## Data Sources and Services

### Direct InfluxDB Writers (modbus-serial services)
All modbus-serial instances write directly to InfluxDB using environment-configured measurements:

1. **modbus-serial-main** → `main` measurement
   - **Device**: SDM630 energy meter (address 1) - "main" power consumption
   - **Data**: 3-phase power, voltage, current, frequency measurements

2. **modbus-serial-secondary** → `secondary` measurement
   - **Devices**: Multiple energy meters and appliances
     - water_pump (EX9EM, addr 1), microwave (OR-WE-514, addr 2)
     - waste_pump (EX9EM, addr 3) - **dead**, oven (DDS519MR, addr 4)
     - stove (DDS519MR, addr 5), dishwasher (DDS519MR, addr 6)
     - kitchen (DDS519MR, addr 7) - **dead**, laundry (DDS519MR, addr 8)
     - boiler (DDS519MR, addr 20) - **Primary boiler energy monitoring**
   - **Data**: Power consumption, voltage, current per device
   - **Dead devices**: `kitchen` last reported 2025-11-24T11:33:36Z and
     `waste_pump` 2026-06-25T21:29:47Z. Both are commented out of
     `config/modbus-serial/secondary.config.js` and write no series at all, so
     a query that groups by `device.name` simply does not see them. Verified
     against InfluxDB on 2026-09-01. `ac-alert.yaml` still excludes `kitchen`
     by name — not because it is dead but because it was a genuinely faulty
     meter (115 samples above 253 V in the year to 2025-09-01); see the comment
     in that file before removing the filter.

3. **modbus-serial-tetriary** → `tetriary` measurement
   - **Device**: Heat pump (DDS024MR, addr 1)
   - **Data**: Heat pump energy consumption and electrical parameters

4. **modbus-serial-monitoring** → `monitoring` measurement (same as `xymd1`)
   - **Devices**: Multiple monitoring and control devices
     - charger (OR-WE-526, addr 1), relays32-47 (ASPAR-MOD-16RO, addr 11)
     - controlbox (XYMD1, addr 51) - **Temperature and relay controller**
     - thermostat-martin/gergana/boris/bedroom (BAC002, addr 65-68)
   - **Data**: Temperature readings, relay states, thermostat setpoints

5. **modbus-serial-monitoring2** → `monitoring2` measurement
   - **Devices**: Additional monitoring equipment
     - heatpump-ctrl (Autonics TF3, addr 50) - Heat pump temperature controller
     - stab-em (OR-WE-516, addr 77) - Stabilizer energy meter
   - **Data**: Temperature control data and additional energy monitoring

6. **modbus-serial-solar** → `solar` measurement
   - **Device**: Solar heater controller (Microsyst SR04, addr 1)
   - **Data**: Solar heating system control and monitoring

7. **modbus-serial-inverter** → `inverter` measurement
   - **Device**: Solar PV inverter (Huawei SUN2000, TCP connection)
   - **Data**: PV power generation, system status, production metrics

8. **modbus-serial-dry-switches** → `dry_switches` measurement
   - **Devices**: Digital I/O and switching devices
   - **Data**: Switch states, digital inputs/outputs

### MQTT Bridge Services (mqtt-influx)
- **mqtt-influx-primary**: `/modbus/main/+/+` → InfluxDB (bridges main bus MQTT to InfluxDB)
- **mqtt-influx-secondary**: `/modbus/secondary/+/+` → InfluxDB (bridges secondary bus MQTT to InfluxDB)
- **mqtt-influx-tetriary**: `/modbus/tetriary/+/+` → InfluxDB (bridges tetriary bus MQTT to InfluxDB)
- **mqtt-influx-dry-switches**: `/modbus/dry-switches/+/reading` → InfluxDB (`dry_switch_input` / `dry_switch_relay` measurements; decomposes packed input/output words into per-bit boolean fields for diagnostics)
- **mqtt-influx-ioniq**: `ioniq/parsed/#` → InfluxDB (`ioniq` measurement; decoded Hyundai Ioniq OBD telemetry, tags `group`/`state`)
- **mqtt-influx-ioniq-sessions**: `ioniq/derived/#` → InfluxDB (`ioniq_sessions` measurement; one record per closed trip/charge/park session from the `ioniq-sessions` bot, tag `kind`)
- **automation-events-processor**: `homy/automation/+/status` → InfluxDB (dedicated service for automation decision events)

### Specialized Monitoring
- **sunseeker-monitoring**: Sunseeker robotic lawn mower telemetry, with its own integrated
  mqtt-influx bridge (subscribes to the vendor cloud broker `mqtts.sk-robot.com`, not the local
  broker) → `sunseeker_*` measurements

## Measurements and Schema

### Primary Energy Monitoring

#### `main` Measurement
**Source**: modbus-serial-main → Main electrical panel (SDM630)
**Note**: per-phase instantaneous voltage/current/power for the mains is in the `current_power` measurement (`bus: "primary"`, `device.name: "main"`), not here — see below.
**Fields**: 3-phase power system metrics - voltage, current, power, frequency, power factor
**Use Cases**: Whole-house energy consumption, electrical system monitoring

#### `current_power` Measurement (from mqtt-influx bridges)
**Source**: `mqtt-influx-primary` / `-secondary` / `-tetriary` bridges convert
`/modbus/<bus>/<device>/reading` MQTT messages into instantaneous readings.
**Tag Structure**: `bus` (`primary` | `secondary` | `tetriary`),
`device.name` (e.g. `main`, `boiler`, `heat_pump`, …), `device.type`,
`device.addr`, and `phase` (`A` | `B` | `C`, on 3-phase meters).
**Fields** (float): `v` (phase voltage), `c` (phase current), `p` (phase power).

**Mains identification**: the whole-house grid meter is `bus = primary`,
`device.name = main` (SDM630), publishing per-phase `v`/`c`/`p` tagged
`phase = A/B/C` at ~1 Hz.

**Consumers**: the per-phase power-loss and total-power-outage alerts
(`config/grafana/provisioning/alerting/phase-power-loss-alert.yaml`,
`total-power-outage-alert.yaml`) and the AC voltage-range alert (`ac-alert.yaml`)
query this measurement's `v` field. See
`docs/superpowers/specs/2026-07-12-per-phase-power-outage-alerting-design.md`.

#### `raw` Measurement (from modbus-serial-secondary)
**Source**: modbus-serial-secondary → Individual appliance monitoring
**Tag Structure**: `bus: "secondary"`, `device.name: [device_name]`
**Note**: Data appears in `raw` measurement, not `secondary` as originally documented
**Key Devices and Fields**:
- **boiler** (DDS519MR, addr 20): `tot` (kWh), `v` (V), `c` (A), `p` (W), `pf`, `freq` (Hz)
- **water_pump** (EX9EM, addr 1): Pump energy consumption
- **kitchen appliances**: oven, stove, dishwasher, microwave - individual energy tracking
- **laundry** (addr 8): Washing machine energy monitoring
**Use Cases**: Appliance-level energy analysis, boiler electric heater monitoring

#### `tetriary` Measurement
**Source**: modbus-serial-tetriary → Heat pump energy monitoring
**Tag Structure**: `bus: "tetriary"`, `device: "heat_pump"`
**Fields**: Heat pump electrical consumption (DDS024MR meter)
**Use Cases**: Heat pump efficiency analysis, HVAC energy tracking

### Temperature and Environmental Monitoring

#### `xymd1` Measurement (from modbus-serial-monitoring)
**Source**: modbus-serial-monitoring → XYMD1 controller + thermostats
**Tag Structure**: `bus: "monitoring"`, `device.name: [device_name]`
**Note**: Data appears in `xymd1` measurement, not `monitoring` as originally documented
**Key Devices and Temperature Fields**:
- **controlbox** (XYMD1, addr 51):
  - `outputs.p1`-`outputs.p8` (boolean): Irrigation relay control states (relays32-47)
  - **Note**: This device primarily handles irrigation system relays, no temperature sensors
- **solar_heater** (Microsyst SR04, addr 1):
  - `t1` (°C): Boiler bottom temperature
  - `t2` (°C): Boiler top temperature
  - `t3` (°C): Solar panel temperature
  - `t6` (°C): Service room temperature
  - `outputs.p1` (boolean): Solar circulation pump control
  - **Primary device**: Both temperature sensors and solar heating system control
- **thermostats** (BAC002, addr 65-68): Individual room temperature control
**Use Cases**: Multi-zone temperature monitoring, solar heating coordination, thermal analysis

#### `monitoring2` Measurement
**Source**: modbus-serial-monitoring2 → Additional monitoring equipment
**Tag Structure**: `bus: "monitoring2"`, `device: [device_name]`
**Key Devices**:
- **heatpump-ctrl** (Autonics TF3, addr 50): Heat pump temperature controller
- **stab-em** (OR-WE-516, addr 77): Electrical stabilizer monitoring
**Use Cases**: Heat pump control monitoring, electrical system stability

### Specialized System Monitoring

#### `solar` Measurement
**Source**: modbus-serial-solar → Solar thermal system controller
**Tag Structure**: `bus: "solar"`, `device: "solar_heater"`
**Fields**: Solar thermal controller data (Microsyst SR04)
**Use Cases**: Solar thermal system optimization, controller status monitoring

#### `inverter` Measurement
**Source**: modbus-serial-inverter → Solar PV inverter (TCP connection)
**Tag Structure**: `bus: "inverter"`, `device: "main"`
**Key Fields**:
- `ap` (float): Instantaneous AC output power in **kW** (`sun2000.js` divides the raw register by 1000)
- `daily_p` (float): Energy generated since local midnight (kWh); resets at the day boundary
- `total_p` (float): Accumulated PV energy production (kWh)
- Additional inverter metrics: `eff`, `freq`, `pf`, `rp`, `temp`, `ins`
**Cadence**: published on change with `maxMsBetweenReports` 5 min, so point density tracks daylight —
roughly 60-77 points/hour while generating against ~11/hour at night.

**Gotcha for alerting**: because the cadence is uneven, InfluxQL `mean("ap")` (which averages over
*points*, not over time) is biased high by 30-40% on any window spanning night. Measured on
2026-01-12, a 12 h window gives `mean("ap")` = 1.286 kW — implying 15.4 kWh — against 12.72 kWh
actually generated. For a time-weighted kW use `GROUP BY time(1h) fill(0)` and average the buckets
(`reducer: avg`), which gives 0.750 kW = 9.0 kWh; or use `integral("ap", 1h)` for kWh directly. Both
solar circuit alert rules depend on this — see
`config/grafana/dashboards/BOILER_CONTROLLER_README.md`.

**Use Cases**: Solar PV production monitoring, grid integration analysis, and as an *independent*
"is the sun out" gate for solar thermal alerting (the collector probe `t3` cannot serve that purpose,
because it is the sensor that fails — issue #1472)

#### `switches` Measurement
**Source**: modbus-serial-dry-switches → Digital I/O monitoring (direct InfluxDB write)
**Tag Structure**: `bus: "switches"`, `device.name`, `device.type`, `device.addr`
**Fields**: Raw packed words as float fields — `inputs` (mbsl32di digital-input modules) and `outputs`/`switches`/RS485 packet counters (aspar-mod-16ro relay modules)
**Note**: Configured via `INFLUXDB_MEASUREMENT=switches` (not `dry_switches` as previously documented). The packed `inputs`/`outputs` words are stored as floats here, which cannot be bit-decoded with InfluxQL — use the `dry_switch_input` / `dry_switch_relay` measurements below for per-bit access.
**Use Cases**: System state monitoring, automation feedback

#### `dry_switch_input` Measurement
**Source**: mqtt-influx-dry-switches → `/modbus/dry-switches/+/reading` (mbsl32di devices)
**Tag Structure**: `bus: "dry-switches"`, `device.name`, `device.type`, `device.addr`
**Fields**:
- `inputs` (int): Raw 32-bit input word (for whole-word glitch detection)
- `bit0`..`bit31` (boolean): Per-input electrical state (e.g. mbsl32di1 `bit0` is the front-door contact; the feature layer inverts this into door open/closed)
- `read_ms` (int): Modbus read duration
**Use Cases**: Diagnosing flaky/stuck contact sensors and false door-open events — plot or alert on an individual bit directly without bitwise math

#### `dry_switch_relay` Measurement
**Source**: mqtt-influx-dry-switches → `/modbus/dry-switches/+/reading` (aspar-mod-16ro devices)
**Tag Structure**: `bus: "dry-switches"`, `device.name`, `device.type`, `device.addr`
**Fields**:
- `outputs` (int), `out0`..`out15` (boolean): Raw and per-relay output state
- `switches` (int): Onboard switch register
- `received_packets` / `incorrect_packets` / `sent_packets` (int): RS485 bus-health counters — a rising `incorrect_packets` indicates serial-bus problems that can corrupt readings for every device on the bus
- `read_ms` (int): Modbus read duration
**Use Cases**: Relay state history and RS485 bus-health diagnostics

### Vehicle Telemetry

#### `ioniq` Measurement
**Source**: `mqtt-influx-ioniq` → `ioniq/parsed/#` (converter `converters/ioniq.js`, `_type: "ioniq"`)
**Tag Structure**:
- `group`: decoded frame group (e.g. `bms/2101`, `tpms`), from `payload.group`
  - `derived/dtc_count` — a bot-produced `group` value (not from the logger): the `ioniq-dtc`
    automations bot publishes it with field `value` = count of active DTCs (union of `dtc/stored`
    + `dtc/pending`) and field `codes` = JSON-stringified array of the code strings. Grafana's
    `ioniq-dtc-present` rule alerts on `value > 0`.
  - `derived/tire_<w>_psi_cold` (`w` ∈ `fl`,`fr`,`rl`,`rr`) — bot-produced by the `ioniq-tpms`
    automations bot: per-wheel tire pressure temperature-compensated to a 15 °C cold reference,
    rounded to 2 decimals. Extra fields `psi` (raw psi) and `temp` (temperature used — the wheel's
    own `.c`, falling back to `ambient.c`). Only emitted for fresh `state='active'` samples,
    de-duplicated against frozen readings.
    Compensation is the ideal gas law on absolute pressure,
    `value = (psi + 14.6959)·288.15/(temp + 273.15) − 14.6959`, since #1479. Before that it was a
    flat `psi − 0.18·(temp − 15)`, which was ~8 % too steep: over all 10 548 points of the first
    27 days the residual slope of `value` against tyre temperature was −0.0291 psi/°C, and the gas
    law brings it to −0.0099. **Values published before #1479 deployed sit lower than the same
    reading does now** — median 0.34 psi across those 10 548 published points, from 0.02 psi at a
    16 °C tyre to a median 0.65 psi at 48 °C (0.75 at the extreme) — so treat a query that spans
    the cutover as two series, not one. The cutover is the date PR #1484 was deployed, not the
    date it was written.
    **Nothing reads this series** — both the alerts and the `Ioniq EV / Tires` dashboard moved to
    `derived/tire_<w>_bar_cold` in #1478. It keeps writing so the psi history already in InfluxDB
    stays a continuous series; retire it only together with that history.
  - `derived/tire_<w>_bar_cold` (`w` ∈ `fl`,`fr`,`rl`,`rr`) — `ioniq-tpms`: the same cold-normalized
    per-wheel pressure expressed in bar. `value` = the **unrounded** cold pressure ÷ 14.5038,
    rounded to 3 decimals (so it can differ from `psi_cold ÷ 14.5038` in the third decimal). 3
    decimals is 0.0145 psi — coarser than the 2-decimal psi series, but finer than the spacing of
    real readings. Extra fields `bar` (raw uncompensated pressure in bar) and `temp`. Published in
    the same frame as `tire_<w>_psi_cold` and derived from the same figure, so the two cannot drift
    apart. Carries the same gas-law change and the same deploy-date discontinuity as `psi_cold`.
    Grafana `ioniq-tpms-*-overinflated` (`> 2.90` info) alerts on it, and the `Ioniq EV / Tires`
    dashboard plots it as the pressure trend.
    **The under-inflation rules no longer read it** (issue #1479): a value normalized to 15 °C
    cannot be compared to a placard that is defined at *ambient*, so it ran ~0.12 bar low at a
    25 °C August ambient and ~0.19 bar high at 0 °C in January — loudest in the season pressures do
    not fall, mute in the one they do. Use `bar_coldstart` for anything thresholded against the
    placard; use this series for trend and for wheel-to-wheel comparison, where the reference
    temperature cancels.
  - `derived/tire_<w>_bar_coldstart` (`w` ∈ `fl`,`fr`,`rl`,`rr`) — `ioniq-tpms`: the wheel's
    **raw, uncompensated** pressure in bar, taken from the first fresh TPMS frame it produces after
    a park of ≥ 6 h, at most once per local calendar day (issue #1479). The tyre has equilibrated
    with ambient overnight, so this reading is directly comparable to the 2.5 bar placard with no
    reference temperature and no external sensor. `value` = raw psi ÷ 14.5038 at 3 decimals; extra
    fields `bar` (**equal to `value` by construction** — that identity is the point: nothing is
    applied to the reading) and `temp` (the wheel's own temperature, omitted if the frame carries
    none). Grafana `ioniq-tpms-<w>-psi-low` (`< 2.20` warn) / `-psi-crit` (`< 1.90` crit) alert on
    it; the rule uids still say `psi` for continuity, and the `Ioniq EV / Tires` dashboard shows it
    as the four headline stat tiles and the "Cold-Start Pressure" panel (pinned to 30 d, because at
    the dashboard's 6 h default a once-a-day series renders empty).
    **Roughly one point per wheel per driving day** — 104 points over 26 days in the 27-day replay
    — so query it with a window of days, not hours. Nothing is published on a day the car is not
    driven, on the first frame after a cold cache (the park length is unknown, and it fails closed),
    or for a second long park later the same day.
    Gated per wheel, not per frame: the four sensors wake staggered, and on 2026-08-04 FR refreshed
    at 05:17:22Z while FL was still replaying a 40 °C value latched the previous evening.
  - `derived/tire_spread_psi` — `ioniq-tpms`: `value` = max − min of the four cold-normalized
    pressures (psi), 2 decimals. No reader left; kept writing for history, as above.
  - `derived/tire_spread_bar` — `ioniq-tpms`: the same spread in bar (÷ 14.5038), 3 decimals.
    Grafana `ioniq-tpms-spread-high` alerts on `value > 0.21` (3 psi converted). Unaffected in
    substance by the #1479 compensation change: this is a difference between four wheels normalized
    the same way, so the reference temperature and most of the formula cancel.
  - `derived/tire_<w>_temp_excess` (`w` ∈ `fl`,`fr`,`rl`,`rr`) — `ioniq-tpms`: `value` = wheel
    temperature minus the mean temperature of the other three wheels (°C). Grafana
    `ioniq-tpms-<w>-temp-excess` alerts on `value > 8`.
  - `derived/cell_spread_mv` — a bot-produced `group` value (not from the logger): the
    `ioniq-cell-health` automations bot publishes field `value` = `(cell_max_v − cell_min_v) · 1000`
    in mV, taken from the single `bms/2101` frame so the two ends of the spread are contemporaneous
    by construction (rest spread; emitted only when `state` is `parked`/`charging`, skipped while
    `active`). Optional field `outlierIndex` = the 1-based cell index (1–96) furthest from the pack
    mean, computed from the 96-cell reassembly (`cells/1` + `cells/33` + `cells/65`); it is **omitted**
    unless the three segments and the `bms/2101` frame all share one freshness window, so the field is
    sparser than `value` — query it with `last("outlierIndex")`. Grafana's `ioniq-cell-spread-*` rules
    alert on `value > 50` (warning) / `> 100` (critical). Before #1418 `value` came from the 96-cell
    join and could merge segments cached across a vehicle sleep, producing 260–3800 mV artefacts.
  - `derived/module_temp_spread_c` — a bot-produced `group` value (not from the logger): the
    `ioniq-cell-health` automations bot merges the 12 battery module temperatures (`module_temps`[5]
    from `bms/2101` + `module_temps_6_12`[7] from `bms/2105`) and publishes field `value` =
    `max − min` in °C. The two frames come from different PIDs, so the point is suppressed unless
    their logger timestamps fall inside the same freshness window. A module-temperature array
    carrying the OBD "no data" signature is discarded rather than merged (#1418): all-zero arrays by
    shape, and partly-zero arrays by cross-checking the lowest module against the `temp_min` the same
    `bms/2101` frame reports (rejected when it sits more than 2 °C below). `bms/2105` carries no
    `temp_min`, so `module_temps_6_12` is cross-checked against the paired `bms/2101` frame's
    `temp_min` at merge time instead. Grafana's `ioniq-module-temp-spread-*` rules alert on
    `value > 8` (warning) / `> 15` (critical).
  - `derived/ldc_ok` — a bot-produced `group` value (not from the logger): the `ioniq-12v-ldc`
    automations bot publishes it from `bms/2101` with field `value` ∈ {0,1}. `0` means the LDC
    (DC-DC converter) is not charging the 12 V battery — `aux_12v` held below 13.2 V for ≥60 s while
    ignition on AND HV load stayed low (the low-voltage judgement is suppressed under heavy traction,
    where a sagging rail is normal load-priority). `1` = OK. Grafana's `ioniq-ldc-not-charging` rule
    alerts on `value < 1`.
  - `derived/aux12v_drop` — a bot-produced `group` value (not from the logger): the `ioniq-12v-ldc`
    bot publishes it from `bms/2101` with field `value` ∈ {0,1}. `1` marks a 12 V sag edge —
    `aux_12v` fell ≥0.8 V within 5 s, or drifted ≥0.3 V/min while parked — latched high for 60 s so a
    1 m Grafana poll catches the pulse. Feeds the 12 V/LDC dashboard; it has no alert rule — the former
    `ioniq-12v-sag` rule fired mostly on normal driving-load swings and was removed as unreliable.
- `state`: vehicle state (`active` / `parked` / `charging` / …), from `payload.state` — low-cardinality, what dashboards filter/group by
**Timestamp**: `payload.ts` (epoch ms), written at `ms` precision
**Fields**: every payload key except `_type`, `group`, `state`, `ts`:
- numbers → float (uniformly, even integers, to avoid InfluxDB int/float type conflicts)
- booleans → boolean; strings → string
- nested objects → recursively flattened into dotted field keys (e.g. `relays.main`)
- arrays → JSON-stringified into a single string field
- Representative fields: `soc`, `hv_v`, `hv_a`, `12v`, `speed`, `relays.main`, `dtc`
**Retention**: kept indefinitely (compact numeric data). The bulky raw archive lives separately in MongoDB (`ioniq` collection, 90-day TTL on `_ts`) — see `docker/mqtt-mongo/CLAUDE.md`.
**Use Cases**: Hyundai Ioniq OBD time-series (SoC, HV pack, speed, temps, TPMS) for Grafana and InfluxQL trip/charging analysis

#### `ioniq_sessions` Measurement
**Source**: `mqtt-influx-ioniq-sessions` → `ioniq/derived/#` (converter `converters/ioniq-session.js`,
`_type: "ioniq-session"`). Published by the `ioniq-sessions` automations bot, one record per closed
session — a low-rate, wide, categorical *records table*, deliberately kept out of the 2 Hz `ioniq`
measurement (see `docs/superpowers/specs/2026-07-18-ioniq-session-segmentation-bot-design.md` §6).
**Tag Structure**:
- `kind`: `trip` | `charge` | `park` — low-cardinality (3 values); the only tag, what dashboards
  filter/group by
**Timestamp**: `start_ts` (epoch ms), written at `ms` precision. Records are intentionally **back-dated to
session start** (not write/emit time) so a "sessions over time" axis places each session where it began —
this matters most for sleep-gap `charge`/`park` rests, which are only computed (and published) retrospectively
on resume, well after `start_ts`. `end_ts` is carried as a field, not the timestamp.
**Fields**: every other payload key, typed by JS runtime type (same discipline as the `ioniq` converter):
numbers → float (uniformly, even integers); booleans → boolean; strings → string; `null`/`undefined` metrics
are **omitted** (no sentinel — a session with an unmeasurable metric simply has no field for it, never a
fabricated `0`). `_type`, `group`, `state`, `ts`, `kind`, `_bot`, `_tz` are excluded from fields (identity/tag/
envelope metadata, not measurement data).
- **Common fields** (all `kind`s): `end_ts` (epoch ms), `duration_sec` (s), `complete` (bool — both boundary
  samples present), `sample_count`, `max_gap_sec` (s), `closed_by` (`gear_park` \| `ignition_edge` \|
  `idle_split` \| `gap_stationary` \| `motion_resume` \| `silence_timeout` \| `restart_lazy_close`), `gear_at_close`, `seq`
  (monotonic per-emit counter), `schema_version`.
- **`trip` fields**: `distance_km` (km; null unless ≥2 distinct odometer readings), `odometer_coverage`
  (0–1), `energy_out_kwh` / `energy_regen_kwh` / `energy_net_kwh` (kWh), `efficiency_wh_per_km` (Wh/km; null
  if `distance_km` null), `soc_start` / `soc_end` / `soc_delta_pct` (%), `speed_avg_kph` / `speed_max_kph`
  (km/h), `power_max_kw` (kW), `ambient_c` (°C, best-effort), `start_truncated` (bool), `contained_plugged`
  (bool).
- **`charge` fields**: `energy_in_kwh` (kWh into pack; always valid), `charge_ah` (Ah; always valid),
  `soc_start` / `soc_delta_pct` / `soc_end` (%), `bounds` (`meter` \| `connector` \| `awake` \| `unbounded`),
  `duration_is_charge` (bool), `power_avg_kw` (kW; null when unbounded), `connector_confirmed` (bool),
  `ac_energy_kwh` (kWh; null without a home-meter match), `charge_efficiency` (0–1; null without meter),
  `charge_type` (`AC` \| `DC` \| `unknown`).
- **`park` fields**: `soc_start` / `soc_end` / `soc_delta_pct` (%), `soc_drain_pct_per_day` (%/day; null if
  `duration_sec` below the config drain-minimum), `aux12v_start` / `aux12v_end` (V, best-effort),
  `connector_confirmed` (bool).
**Retention**: kept indefinitely (compact, one row per session). Session records also reach MongoDB via the
existing `mqtt-mongo-ioniq` (`ioniq/#`) subscription — append-only, so downstream consumers there must
de-dup on `(kind, start_ts, end_ts)`.
**Use Cases**: per-trip distance/energy/efficiency, charge-session energy/power/efficiency, parasitic-drain
analysis, and the "Trips & charging" Grafana dashboard (`docs/ioniq-monitoring-alerting-spec.md` §7) — this
measurement is its data source, unblocking the dashboard that was previously deferred for lack of session
boundaries.

### Lawn Mower Telemetry

**Source**: the `sunseeker-monitoring` service, which connects directly to the Sunseeker vendor
cloud broker (`mqtts.sk-robot.com`), parses the device's proprietary messages, and writes InfluxDB
itself — it does not pass through the local MQTT broker or the shared `mqtt-influx` service.
Subscribes to `/device/<deviceId>/+` and `/app/<appId>/+`; each message is routed by its `cmd`
field (`src/message-parser.js`).

**Common tags** (every `sunseeker_*` measurement): `device_id` (the mower's serial) and `service`
(always `sunseeker-mqtt-influx`, applied as a write-API default tag).

| Measurement | Source `cmd` | Fields | Notes |
|---|---|---|---|
| `sunseeker_mode` | 501 | `mode` (int), `mode_text` (string) | `0` standby, `1` mowing, `2` on_the_way_home, `3` charging, `7` mowing_border |
| `sunseeker_power` | 501 | `battery_percentage` (int) | Coarse battery level from the status frame |
| `sunseeker_station` | 501 | `at_station` (bool) | Docked on the charging station |
| `sunseeker_battery_detail` | 509 | see below | Detailed battery/orientation metrics parsed out of log text |
| `sunseeker_battery_info` | 512 | `battery_id` (int), `battery_type` (string), `charge_times` (int), `discharge_times` (int) | Pack identity and cycle counts |
| `sunseeker_state_change` | 511 | `message_code` (int), `timestamp` (int) | Device-reported state transitions |
| `sunseeker_commands` | 400 | `command` (int), `result` (bool) | Acknowledgements for commands sent to the mower |
| `sunseeker_connection` | any | `connected` (bool, always `true`) | Heartbeat written on every received message — see below |

#### `sunseeker_battery_detail` Measurement
**Source**: `cmd` 509 log messages, whose free-text body is scraped with regexes
(`bat vol=`, `percent=`, `min=`, `max=`, `temp=`, `current=`, `pitch=`, `roll=`, `heading=`; all
match unsigned integers only, so negative current or orientation values are silently unparsed).
Fields are written only when the corresponding pattern is present, so points can be missing fields —
queries must tolerate that rather than assume a fixed shape. But the fields are **not** evenly
sparse: measured on prod over 7/30 days, `percentage` and `temperature` are present on essentially
every point (99%+), `min_cell_voltage`/`max_cell_voltage` on ~98%, and `voltage` on ~83-84% — none of
these are a minority case. The genuinely sparse fields are `current`, `pitch`, `roll` and `heading`
(7-27% of points).

**`voltage`/`current` presence is activity-gated, not simply "charging only".** Verified directly:
0/8 points in a mowing window carried them, 22/22 in a charging window did. But the resulting *share*
of points that carry them moves with how much the mower mowed vs. charged that particular week — a
duty-cycle artifact, not a stable percentage to design around. Measured `voltage` gaps run 78-130
min, confirming it isn't reported continuously even while awake. **`percentage` is the most
consistently present field and is the correct choice for a staleness `count()`** — see
`config/grafana/CLAUDE.md` ("Staleness / Absence Alerts").

**Extra tag**: `temp_alert` — `high` (≥40 °C), `low` (≤10 °C), or `normal`, from
`TEMPERATURE.HIGH_THRESHOLD` / `LOW_THRESHOLD` in `src/constants.js`. Note these bounds are **not**
the same as the Grafana temperature alert thresholds (>45 °C / <5 °C), so the tag and the alert
rules disagree by design-drift; prefer the raw `temperature` field for analysis.

**Fields**: raw milli-unit readings are kept alongside their converted forms for compatibility.

| Field | Type | Unit | Notes |
|---|---|---|---|
| `voltage` / `voltage_mv` | float / int | V / mV | Pack voltage; activity-gated, see above |
| `min_cell_voltage` / `min_cell_mv` | float / int | V / mV | Lowest cell |
| `max_cell_voltage` / `max_cell_mv` | float / int | V / mV | Highest cell |
| `current` / `current_ma` | float / int | A / mA | Pack current |
| `percentage` | int | % | Battery level; most consistently present, see above |
| `temperature` | int | °C | Pack temperature |
| `pitch`, `roll`, `heading` | int | ° | Chassis orientation |

**Field typing is load-bearing.** `voltage`, `min_cell_voltage`, `max_cell_voltage` and `current`
are derived by dividing a milli-unit reading by 1000, so they periodically land on an exact integer
(4000 mV / 1000 === 4). InfluxDB 1.x fixes a field's type **per 7-day shard group** from the first
write of that field in the shard, and rejects every later conflicting write with a 400 —
**dropping the whole point**, not just the offending field. Typing these fields from the runtime
value therefore silences the entire measurement for up to a week. They are declared in
`FLOAT_FIELDS` (`src/constants.js`) and always written as floats; any new fractional field must be
added there too. See PR #1430.

**Residual dual typing (harmless)**: `SHOW FIELD KEYS` still lists `max_cell_voltage` and
`min_cell_voltage` as **both** float and integer, because the field-key list is a union across all
shards and pre-#1430 shards still hold integer-typed writes from before the fix. This is historical
residue, not a live problem — `count(max_cell_voltage)` and `count(min_cell_voltage)` are identical
over both 24h and 7d windows, so nothing is being silently dropped now. Don't mistake it for a
recurrence of the #1430 bug.

**Cadence**: ~12 points/hour (~5 min interval) while idle, rising to ~18-30/hour while mowing or
charging — roughly 288/day at the healthy floor. A sustained gap means either the mower is
unreachable or ingestion is broken — `sunseeker_connection` distinguishes the two.

#### `sunseeker_connection` Measurement
**Source**: written by the service on **every** received MQTT message, with `connected` hard-coded
to `true`. It is a liveness heartbeat, not a state field: there is no `connected=false` record, so
disconnection is detected by *absence* of points, which is why the connectivity alert counts rows
(`SELECT count("connected") ... WHERE "connected" = true`) rather than reading the last value.

**Cadence**: ~12-16 points/hour in standby (every ~5 min, including overnight) rising to
100-241/hour while mowing. The heartbeat does not go quiet when the mower is merely idle, but it
does during genuine outages — measured over 30 days on prod, 8 gaps exceeded 30 minutes: 42, 46, 63,
343, 380, 468, 543 and 1497 minutes.

**Use Cases**: mower connectivity alerting; separating "mower unreachable" from "telemetry
pipeline broken" when `sunseeker_battery_detail` goes stale but this measurement keeps flowing.
Measured on prod, `sunseeker_battery_detail` can stall up to 25 min *before* `sunseeker_connection`
does, so the connectivity alert (`sunseeker-connection-lost`, ~30-35 min to page) reliably names a
genuinely unreachable mower before the battery-telemetry staleness alert does (~90-95 min); see
`config/grafana/CLAUDE.md` ("Staleness / Absence Alerts") for the alert design and the accepted
trade-off of both firing for one real outage.

### Automation System Monitoring

#### `automation_status` Measurement
**Source**: automation-events-processor → `homy/automation/+/status` topics
**Status**: ✅ **Being written** - verified 2026-08-09: 1101 points for `service='boilerController'` in
the preceding 7 days, most recent at `2026-08-09T11:39:16Z`. An earlier note in this file claimed the
measurement was unavailable because of InfluxDB authentication errors; that has not been true for some
time. The two alert rules that read it - `boiler-controller-emergency-heating` and
`boiler-controller-not-responding` - see live data (32 points matching `reason =~ /.*emergency.*/` in
the 30 days to 2026-08-09; 6 points in the trailing 30 minutes).
**Tag Structure**: `service: [controller_name]`, `type: "status"`, `source`, plus `reason` and
`controlMode` (see below)
**Key Fields**:
- **Controller Decisions** (Source of Truth):
  - `reason` (**tag**, not a field): Decision reasoning. Observed values: `comfort_heating_insufficient`,
    `emergency_heating_bottom_cold`, `emergency_heating_top_cold`, `hysteresis_zone_maintain_false`,
    `hysteresis_zone_maintain_true`, `solar_priority_available`, `temperature_sufficient`
  - `controlMode` (**tag**, not a field): Current operation mode ("automatic", "manual_on", "manual_off", "vacation_3d", etc.)
  - `manualOverrideExpires` (integer field): When manual mode expires (0 for automatic mode)

  **Gotcha**: `reason` and `controlMode` are written as tags by
  `docker/automation-events-processor/processor.js`, so `SELECT count("reason")` returns nothing.
  `SHOW FIELD KEYS` still lists `reason`/`controlMode` as string fields - those are leftovers from an
  older schema and hold no recent points. Filter on them (`WHERE reason =~ /.*emergency.*/`) and count
  a real field instead. Prefer `count("heaterState")` over `count(*)`: `count(*)` returns one column
  per field, which in a `classic_conditions` alert becomes a multi-series frame.
- **Controller View** (For Correlation):
  - `heaterState` (boolean): Controller's intended relay state
  - `solarCirculation` (boolean): Solar pump state as seen by controller
  - `temp_*_seen` (float): Temperature readings as seen by controller when making decision
**Use Cases**:
- Automation decision tracking and analysis
- Controller performance monitoring
- Decision correlation with actual sensor data
- Troubleshooting automation logic issues
- Energy efficiency analysis of heating decisions

## Data Quality Notes

### Reliable Data Sources
- ✅ Boiler energy consumption (`raw` measurement)
- ✅ Temperature sensors (`xymd1` measurement)
- ✅ Solar circulation pump status
- ✅ Solar PV production data

### Data to Ignore
- ❌ `outputs.p6` (solar_heater_electric_heater flag) - Misconfigured
- ⚠️ Solar PV data does not *heat* the boiler (different electrical network), so it must not be read as
  a boiler energy input. It is nonetheless the correct proxy for "the sun is out" when alerting on the
  solar **thermal** circuit, and both solar circuit alert rules use it that way.

## Query Examples (Verified)

### Energy Consumption Analysis
```sql
-- Boiler energy consumption (using device.name tag)
SELECT tot FROM raw
WHERE "device.name"='boiler'
AND time > now() - 7d

-- Individual appliance power monitoring
SELECT * FROM "power.boiler" WHERE time > now() - 1h
SELECT * FROM "power.dishwasher" WHERE time > now() - 1h
```

### Temperature Monitoring
```sql
-- Boiler temperature analysis (corrected device)
SELECT t1, t2, t3, t6 FROM xymd1
WHERE "device.name"='solar_heater'
AND time > now() - 24h

-- Solar circulation pump control
SELECT "outputs.p1" FROM xymd1
WHERE "device.name"='solar_heater'
AND time > now() - 1h

-- Irrigation relay control states
SELECT "outputs.p4", "outputs.p5" FROM xymd1
WHERE "device.name"='controlbox'
AND time > now() - 1h

-- Thermostat monitoring
SELECT currentTemp, targetTemp FROM xymd1
WHERE "device.type"='bac002'
AND time > now() - 6h
```

### Solar and Inverter Monitoring
```sql
-- Solar heating system monitoring (all data from solar_heater device)
SELECT t2, t3, "outputs.p1" FROM xymd1
WHERE "device.name"='solar_heater' AND time > now() - 1h

-- Solar PV production analysis
SELECT total_p, daily_p, eff, temp FROM inverter
WHERE time > now() - 24h
```

### Automation System Analysis
```sql
-- Boiler controller decision analysis
SELECT reason, controlMode, heaterState FROM automation_status
WHERE "service"='boilerController'
AND time > now() - 24h

-- Controller performance correlation
SELECT reason, heaterState, temp_top_seen FROM automation_status
WHERE "service"='boilerController'
AND controlMode='automatic'
AND time > now() - 7d
```

## Integration Points

### Home Assistant
Home Assistant entities map to InfluxDB data:
- `sensor.boiler_energy_used` → `raw.tot` (device.name='boiler')
- `sensor.temperature_boiler_high` → `xymd1.t2` (device.name='solar_heater')
- `sensor.temperature_boiler_low` → `xymd1.t1` (device.name='solar_heater')
- `sensor.temperature_solar_panel` → `xymd1.t3` (device.name='solar_heater')
- `binary_sensor.solar_heater_circulation` → `xymd1.outputs.p1` (device.name='solar_heater')

### Grafana Dashboards
- Access through provisioned InfluxDB data source
- Standard queries use measurement names and tag filtering
- Time-series visualization with sub-second resolution

### MongoDB Backup
Raw modbus data is also stored in MongoDB collections:
- `secondary` - Raw boiler modbus data
- `monitoring` - Raw solar controller data
- `inverter` - Raw PV inverter data

## Data Retention and Performance

### Storage Characteristics
- **High-frequency data**: Temperature readings every 1-30 seconds
- **Medium-frequency data**: Energy readings every 1-5 minutes
- **Historical depth**: Data available back to 2022
- **Database size**: Substantial historical dataset requiring proper retention policies

### Performance Considerations
- **Query optimization**: Use appropriate time ranges to avoid large dataset scans
- **Tag filtering**: Leverage tags (bus, device) for efficient filtering (indexed)
- **Field queries**: Fields are not indexed - avoid WHERE clauses on field values for performance
- **Data volume**: High-frequency temperature data (~30s intervals) and energy data (~1min intervals)
- **Downsampling**: Consider aggregation for long-term trend analysis (>1 month queries)
- **Concurrent services**: 8+ modbus-serial services + 3 mqtt-influx bridges writing simultaneously

## Future Enhancements

### Planned Additions
- ✅ **Automation system status data** - Added `automation_status` measurement for controller decisions and modes
- Feature state tracking (relay states, sensor readings via `homy/features/+/status` topics)
- Enhanced monitoring for new devices and systems

### Schema Evolution
When adding new measurements or modifying existing ones:
1. **Document first**: Update this schema documentation with measurement details
2. **Service documentation**: Update relevant service CLAUDE.md files with integration details
3. **Tag cardinality**: Consider tag cardinality impact (device names, bus identifiers)
4. **Data retention**: Plan retention policies based on data frequency and storage requirements
5. **Dashboard integration**: Update Grafana dashboards and alert rules
6. **Cross-service impact**: Consider MQTT bridge services that may duplicate data

### Service Integration Map
```
Modbus Devices → modbus-serial-* → Direct InfluxDB Write
                                 ↓
Modbus Devices → modbus-serial-* → MQTT Publish → mqtt-influx-* → InfluxDB Write

Sunseeker mower → vendor cloud broker (mqtts.sk-robot.com) → sunseeker-monitoring → InfluxDB Write
```

**Note**: `sunseeker-monitoring` is the one writer that bypasses the local broker entirely — it
subscribes to an external vendor broker and writes InfluxDB directly, so its data path shares no
infrastructure with the `modbus-serial` / `mqtt-influx` pipelines and fails independently of them.

**Note**: The actual system is more complex than initially documented, with 60+ distinct measurements including device-specific power monitoring.