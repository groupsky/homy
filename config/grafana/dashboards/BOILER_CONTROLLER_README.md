# Boiler Controller Monitoring Dashboard

## Overview

This dashboard provides comprehensive monitoring and analysis of the boiler controller automation system, including temperature sensors, energy consumption, automation decisions, and system health.

## Dashboard Sections

### 1. Boiler Controller Status
- **Control Mode**: Current automation mode (automatic, manual, vacation)
- **Heater State**: Current boiler heater on/off status
- **Solar Circulation**: Solar pump circulation status
- **Last Decision Reason**: Most recent automation decision explanation

### 2. Temperature Monitoring
- **Temperature Sensors**: Real-time multi-point temperature tracking
  - Boiler Top (t2) - Primary control temperature
  - Boiler Bottom (t1) - Secondary temperature monitoring
  - Solar Panel (t3) - Solar heating effectiveness
  - Service Room (t6) - Ambient temperature monitoring
- **Thresholds**: Visual indicators for critical temperature limits (85°C safety shutoff)

### 3. Energy Consumption
- **Boiler Power**: Real-time power consumption monitoring
- **Energy Total**: Cumulative energy consumption tracking
- **Efficiency Analysis**: Power usage correlation with temperature demands

### 4. Decision History & Analysis
- **Recent Decisions**: Detailed table of automation decisions with timestamps
- **Decision Distribution**: Pie chart showing reason categories breakdown
- **Control Mode Usage**: Analysis of automatic vs manual operation patterns

## Key Metrics

### Temperature Monitoring
- **Safety Threshold**: 85°C maximum (red threshold line)
- **Comfort Range**: 50-85°C optimal operation
- **Emergency Heating**: Triggered below 45°C

### Power Consumption
- **Normal Operation**: 0-3kW typical range
- **High Consumption**: >3kW sustained indicates potential issues
- **Energy Efficiency**: kWh tracking for usage analysis

### Decision Reasons (Simplified Categories)
- `comfort_heating_insufficient` - Standard heating demand
- `emergency_heating_top_cold` - Critical low temperature
- `emergency_heating_bottom_cold` - Bottom sensor critical
- `solar_priority_available` - Solar heating sufficient
- `solar_insufficient_boost_needed` - Solar heating inadequate
- `temperature_sufficient` - No heating needed
- `safety_shutoff_overheated` - Safety temperature exceeded
- `hysteresis_zone_maintain_*` - Maintaining current state

## Alert Integration

The dashboard integrates with the 7 rules provisioned in
`config/grafana/provisioning/alerting/boiler-controller-alerts.yaml`. (An eighth, "Manual Mode
Extended" / `boiler-controller-manual-mode-stuck`, was removed via
`delete-boiler-manual-mode-alert.yaml` and no longer exists.)

### Critical Alerts
1. **Boiler Overheating** (`boiler-controller-overheating`) - Temperature >85°C for 2+ minutes
2. **Controller Not Responding** (`boiler-controller-not-responding`) - No decisions for 30+ minutes

### High Priority Alerts
3. **Temperature Sensor Failure** (`boiler-temperature-sensor-failure`) - No readings for 30+ minutes
4. **Emergency Heating Active** (`boiler-controller-emergency-heating`) - Critical low temperature for 10+ minutes
5. **No Solar Contribution On A Sunny Day** (`boiler-solar-no-contribution`) - boiler top has not
   exceeded the 50°C electric cutoff in 12 hours while the PV inverter averaged >1.3 kW over the same
   window, i.e. every kWh in the tank came from the immersion heater. See "Solar circuit alert
   thresholds" below.

### Warning Alerts
6. **Excessive Power** (`boiler-excessive-power-consumption`) - >3kW consumption for 15+ minutes
7. **Solar Circulation Idle While Sunny** (`boiler-solar-circulation-stuck`) - under ~2 minutes of pump
   run time in 6 hours while the PV inverter averaged >1.5 kW and the boiler top stayed below 55°C.
   See "Solar circuit alert thresholds" below.

## Solar circuit alert thresholds

The SR-04 runs a `kick` anti-seize function - a 2-3 second pump pulse roughly every 22 minutes across
its daylight window (`kickOn: 8`, `kickOff: 20`). So `outputs.p1` toggles in **every** daylight hour
whether or not any heat moves, and holds a single value all night when the pump is correctly idle.
**Any rule keyed on `outputs.p1` state changes is inverted with respect to the failure it is meant to
catch.** The original `count(DISTINCT "outputs.p1") <= 1` rule, replayed over 107 days of production
data, fired on 45% of all hours - every night, all 107 days - and never once during the 63-day solar
outage of 2026-06-08…2026-08-09 (issue #1472).

The replacements measure *how long the pump ran* (a sample count of `outputs.p1 = true`), gate on PV
output from the **inverter** rather than the collector probe `t3` (the probe is what failed silently in
#1472), and suppress the legitimate "tank already hot" case using the electric cutoff at 50°C
(`comfortMin: 47` + `hysteresis: 3`).

| Rule | Window | Conditions | Verified behaviour (replay, hourly) |
|---|---|---|---|
| `boiler-solar-circulation-stuck` | 6 h | `count(outputs.p1=true) < 100` **and** `mean(inverter.ap) > 1.5 kW` **and** `max(t2) < 55 °C`, `for: 1h` | 0 alert days in the 44 healthy days 2026-04-25…06-07; 50 of the 63 outage days, first on 2026-06-08 (day one). Fires only 10:00Z–17:00Z. |
| `boiler-solar-no-contribution` | 12 h | `max(t2) < 50.5 °C` **and** `mean(inverter.ap) > 1.3 kW`, `for: 1h` | 1 alert day in the same 44 healthy days (2026-05-13, itself a genuine no-contribution day); 56 of the 63 outage days, first on 2026-06-08. Fires 12:00Z–21:00Z. |

Together they alerted on 59 of the 63 outage days. The four misses (2026-06-12, 2026-07-02,
2026-07-23, and the repair day 2026-08-09) were low-yield or data-outage days.

Threshold caveats:
- **`< 100` samples is tied to the poll rate.** The solar Modbus bus polls ~every 1.27 s (~2830
  samples/hour), so kick alone leaves ~48 samples per 6 h window while a healthy sunny morning leaves
  ~4400. If the bus gains devices or slows, re-measure and retune.
- **`noDataState: OK` on both rules.** InfluxQL `count()` over a range with no matching rows returns no
  rows, not `0`, so `outputs.p1 = true` is NoData for most of every night. The cost is that a pump
  wedged fully off - kick included - is invisible to `boiler-solar-circulation-stuck`;
  `boiler-solar-no-contribution` covers that case because it never reads `outputs.p1`.
- **`boiler-solar-no-contribution` is dormant in winter** by design: ~15.6 kWh inside a 12 h window is
  not reachable, so no seasonal mute is needed.

## Data Sources

### InfluxDB Measurements
- `automation_status` - Controller decisions and state (automation-events-processor). **Being written**;
  verified 2026-08-09: 1101 points for `service='boilerController'` in the preceding 7 days, most
  recent at `2026-08-09T11:39:16Z`. An earlier note here claimed the measurement was unavailable due
  to InfluxDB authentication errors - that is no longer true. Note `reason` and `controlMode` are
  **tags**, not fields: filter on them, but count a real field.
- `inverter` - PV inverter output (modbus-serial-inverter → Huawei SUN2000). `ap` is instantaneous AC
  power in kW; used as the "is the sun out" gate by both solar circuit alerts.
- `xymd1` - Temperature sensors and relay controls (modbus-serial-monitoring)
  - Temperature data: `solar_heater` device (t1, t2, t3, t6)
  - Solar circulation pump: `solar_heater` device (outputs.p1)
  - Irrigation relays: `controlbox` device (outputs.p1-p8, relays32-47)
- `raw` - Boiler power consumption (modbus-serial-secondary → DDS519MR meter)

### Query Patterns
```sql
-- Controller decisions (reason/controlMode are tags, so SELECT * returns them as columns)
SELECT * FROM "automation_status" WHERE "service"='boilerController'

-- Temperature monitoring (corrected device mapping)
SELECT "t1", "t2", "t3", "t6" FROM "xymd1" WHERE "device.name"='solar_heater'

-- Energy consumption (corrected)
SELECT "p", "tot" FROM "raw" WHERE "device.name"='boiler'

-- Solar circulation status (from solar_heater device)
SELECT "outputs.p1" FROM "xymd1" WHERE "device.name"='solar_heater'
```

## Navigation

This dashboard is part of the Water System monitoring family:
- **Related Dashboards**: Heat pump, solar system, water circulation
- **Dashboard Links**: Navigation panel connects to other water system views
- **Tags**: `automation`, `boiler`, `water-system`, `temperature`, `energy`

## Time Ranges & Refresh

- **Default Range**: Last 24 hours
- **Refresh Rate**: 30 seconds for real-time monitoring
- **Historical Analysis**: Supports longer ranges for trend analysis
- **Data Retention**: Historical data available back to 2022

## Troubleshooting

### Common Issues
1. **No Data in Panels**: Check InfluxDB connectivity and service status
2. **Missing Temperature Data**: Verify modbus-serial-monitoring service
3. **Missing Decision Data**: `automation_status` is being written (verified 2026-08-09). If a panel is
   empty, check whether it selects `reason`/`controlMode` as *fields* - they are tags, and
   `SELECT count("reason")` returns nothing
4. **Solar Alert Not Firing**: both solar circuit rules use `noDataState: OK` and are deliberately
   gated on PV output, so they stay silent at night, on dull days and through winter. See "Solar
   circuit alert thresholds" above
5. **Authorization Failed**: WHERE clauses in queries may have authentication restrictions

### Service Dependencies
- **automation-events-processor**: Automation decision events
- **modbus-serial-monitoring**: Temperature sensors and solar circulation (solar_heater), irrigation relays (controlbox)
- **modbus-serial-secondary**: Boiler energy consumption
- **boiler-controller bot**: Automation logic and MQTT publishing

## Maintenance

### Dashboard Updates
- Dashboard is provisioned automatically via Grafana
- JSON file located: `config/grafana/dashboards/boiler-controller.json`
- Updates require container restart to reload

### Alert Rules
- Alert rules provisioned from: `config/grafana/provisioning/alerting/boiler-controller-alerts.yaml`
- Notifications route to existing telegram-webhook contact point
- Rule evaluation interval: 1 minute

### Performance
- Optimized queries with appropriate time windows
- Efficient aggregation (1-5 minute intervals)
- Dashboard supports concurrent users without performance impact