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
     - waste_pump (EX9EM, addr 3), oven (DDS519MR, addr 4)
     - stove (DDS519MR, addr 5), dishwasher (DDS519MR, addr 6)
     - kitchen (DDS519MR, addr 7), laundry (DDS519MR, addr 8)
     - boiler (DDS519MR, addr 20) - **Primary boiler energy monitoring**
   - **Data**: Power consumption, voltage, current per device

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
- **automation-events-processor**: `homy/automation/+/status` → InfluxDB (dedicated service for automation decision events)

### Specialized Monitoring
- **sunseeker-monitoring**: Solar tracking and monitoring with integrated mqtt-influx bridge

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
- `total_p` (float): Accumulated PV energy production (kWh)
- Additional inverter metrics: power output, system status
**Use Cases**: Solar PV production monitoring, grid integration analysis

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
    automations bot: per-wheel tire pressure temperature-compensated to a 15 °C cold reference
    (`value = psi − 0.18·(temp − 15)` psi, using the wheel's own `.c` temp, falling back to
    `ambient.c`). Extra fields `psi` (raw psi) and `temp` (temperature used). Only emitted for fresh
    `state='active'` samples, de-duplicated against frozen readings. Grafana `ioniq-tpms-*-psi-low`
    (`< 30` warn) / `-psi-crit` (`< 26` crit) / `-overinflated` (`> 42` info) rules alert on it.
  - `derived/tire_spread_psi` — `ioniq-tpms`: `value` = max − min of the four cold-normalized
    pressures (psi). Grafana `ioniq-tpms-spread-high` alerts on `value > 3`.
  - `derived/tire_<w>_temp_excess` (`w` ∈ `fl`,`fr`,`rl`,`rr`) — `ioniq-tpms`: `value` = wheel
    temperature minus the mean temperature of the other three wheels (°C). Grafana
    `ioniq-tpms-<w>-temp-excess` alerts on `value > 8`.
  - `derived/cell_spread_mv` — a bot-produced `group` value (not from the logger): the
    `ioniq-cell-health` automations bot reassembles the 96-cell pack (from `cells/1`, `cells/33`,
    `cells/65`) and publishes field `value` = `(max − min) · 1000` in mV (rest spread; emitted only
    when `state` is `parked`/`charging`, skipped while `active`), plus field `outlierIndex` = the
    1-based cell index (1–96) furthest from the pack mean. Grafana's `ioniq-cell-spread-*` rules alert
    on `value > 50` (warning) / `> 100` (critical).
  - `derived/module_temp_spread_c` — a bot-produced `group` value (not from the logger): the
    `ioniq-cell-health` automations bot merges the 12 battery module temperatures (`module_temps`[5]
    from `bms/2101` + `module_temps_6_12`[7] from `bms/2105`) and publishes field `value` =
    `max − min` in °C. Grafana's `ioniq-module-temp-spread-*` rules alert on `value > 8` (warning) /
    `> 15` (critical).
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

### Automation System Monitoring

#### `automation_status` Measurement
**Source**: automation-events-processor → `homy/automation/+/status` topics
**Status**: ⚠️ **Currently not available** - Service experiencing InfluxDB authentication errors
**Tag Structure**: `service: [controller_name]`, `type: "status"`
**Key Fields**:
- **Controller Decisions** (Source of Truth):
  - `reason` (string): Decision reasoning (e.g., "comfort_heating_insufficient", "solar_priority_available")
  - `controlMode` (string): Current operation mode ("automatic", "manual_on", "manual_off", "vacation_3d", etc.)
  - `manualOverrideExpires` (timestamp): When manual mode expires (null for automatic mode)
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
- ⚠️ Solar PV data not directly applicable to boiler heating (different electrical network)

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
```

**Note**: The actual system is more complex than initially documented, with 60+ distinct measurements including device-specific power monitoring.