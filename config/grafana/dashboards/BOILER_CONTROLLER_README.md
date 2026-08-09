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
- `solar_insufficient_boost_needed` - Solar heating inadequate. **Never emitted**: the branch is gated
  on `solarDisadvantageMax`, which the live config sets to `-100`, so it is unreachable. `SHOW TAG
  VALUES` returns the other seven reasons and not this one.
- `temperature_sufficient` - No heating needed
- `safety_shutoff_overheated` - Safety temperature exceeded
- `hysteresis_zone_maintain_*` - Maintaining current state

## Alert Integration

The dashboard integrates with the 7 rules provisioned in
`config/grafana/provisioning/alerting/boiler-controller-alerts.yaml`. ("Manual Mode Extended" /
`boiler-controller-manual-mode-stuck` used to be among them; it was removed in `7342ea2` via
`delete-boiler-manual-mode-alert.yaml`, leaving six, and `boiler-solar-no-contribution` brings the
count back to seven.)

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

The SR-04 runs a `kick` anti-seize function - a short pump pulse every ~15-27 minutes across its
daylight window (`kickOn: 8`, `kickOff: 20`; the device's own `kickPause` register reads 30 and
`kickTime` 3). So `outputs.p1` toggles in **every** daylight hour whether or not any heat moves, and
holds a single value all night when the pump is correctly idle. **Any rule keyed on `outputs.p1` state
changes is inverted with respect to the failure it is meant to catch.** The original
`count(DISTINCT "outputs.p1") <= 1` rule, replayed over 107 days of production data, fired on ~45% of
all hours - every night, all 107 days - and never once during the 63-day solar outage of
2026-06-08…2026-08-09 (issue #1472).

The replacements measure *how long the pump ran* (a sample count of `outputs.p1 = true`), gate on PV
output from the **inverter** rather than the collector probe `t3` (the probe is what failed silently in
#1472), and suppress the legitimate "tank already hot" case using the electric cutoff at 50°C
(`comfortMin: 47` + `hysteresis: 3`).

| Rule | Window | Conditions | Verified behaviour (hourly replay, 2024-08-01…2026-08-09) |
|---|---|---|---|
| `boiler-solar-circulation-stuck` | 6 h | `count(outputs.p1=true) < 100` **and** time-weighted `mean(inverter.ap) > 1.5 kW` **and** `max(t2) < 55 °C`, `for: 1h` | **0** alert days outside the outage across two full years, neither winter included; 50 of the 63 outage days, first on 2026-06-08 (day one). Fires only 10:00Z–17:00Z. |
| `boiler-solar-no-contribution` | 12 h | `max(t2) < 50.5 °C` **and** time-weighted `mean(inverter.ap) > 1.3 kW`, `for: 1h` | 4 alert days outside the outage across two years (2025-05-28, 2026-02-25, 2026-04-08, 2026-05-13) — all genuine no-contribution days, see below; 56 of the 63 outage days, first on 2026-06-08. Fires 12:00Z–21:00Z. |

Together they alerted on 59 of the 63 outage days. The four misses were 2026-06-12 and 2026-07-02 (too
little sun to pass the PV gate), 2026-07-23 (a 7.8 h data outage — the bare `mean("ap")` reads 1.66 kW
there against 0.42 time-weighted, which is the point-weighting bias in miniature) and 2026-08-09, the
repair day.

Threshold caveats:
- **The PV gate must be time-weighted, and this is the single easiest thing to get wrong here.**
  InfluxQL `mean()` averages over *points*, not over time. The inverter publishes on change
  (`maxMsBetweenReports` 5 min), logging ~60-77 points/hour in daylight against ~11/hour at night, so
  a bare `mean("ap")` over a 12 h window is biased high by 30-40%. Both rules therefore use
  `GROUP BY time(1h) fill(0)` with `reducer: avg`, which averages hourly buckets and yields a true
  time-weighted kW — so `threshold × window hours` really is kWh. Measured on 2026-01-12: bare
  `mean("ap")` = 1.286 kW (implying 15.4 kWh) against 12.72 kWh actually generated; the bucketed form
  gives 0.750 kW = 9.0 kWh. An earlier draft used the bare form and fired on ordinary
  December–February days.
- **`< 100` samples is tied to the poll rate.** The solar Modbus bus polls every ~1.28 s (2810-2814
  samples/hour), so kick alone leaves ~38-48 samples per 6 h window. A healthy sunny *morning* can
  leave 4000+, but that is a best case, not the norm — daily pump-on totals across healthy days range
  70 to 6147 with a median around 1400, and quiet healthy days sit at or below the threshold for a
  whole day. The real protection against false alarms is the PV gate, not this margin. If the bus
  gains devices or slows, re-measure and retune.
- **`noDataState: OK` on both rules.** The mechanism is *not* "the rule goes NoData at night":
  Grafana's `classic_conditions` combines the per-condition NoData flag with the same `and` operator
  as the firing flag, and `solar_kw`/`tank_top` always return rows, so the ANDed NoData collapses to
  false. What actually happens is that InfluxQL `count()` over a range with no matching rows returns
  no rows, and an empty input makes that condition evaluate **false** — so the rule reports OK. Same
  outcome, and the same blind spot either way: a pump wedged fully off (kick included) is invisible to
  `boiler-solar-circulation-stuck`. `boiler-solar-no-contribution` covers that case because it never
  reads `outputs.p1`.
- **`boiler-solar-no-contribution` is NOT dormant in winter**, and must not be assumed to be. With the
  time-weighted gate the winter firings largely drop away, but 2026-02-25 still alerts. All four
  non-outage alert days are true positives by the rule's own definition: PV yield 18.1-24.2 kWh with
  the collector peaking at 49.2-51.8 °C against a tank held at 50.0-50.4 °C — the solar circuit really
  did contribute nothing. Expect roughly two such alerts a year.
- **Both rules fire on most of the same days during a real fault**, in overlapping hours, under
  different alertnames — so a sustained outage pages roughly twice as often as one rule alone. This is
  accepted for the same reason as the sunseeker connectivity/staleness pair: neither rule can see the
  other's failure mode. See `config/grafana/CLAUDE.md`.
- **`count(outputs.p1=true)` falls during poller outages, not only when the pump idles.** A long
  `xymd1` gap inside the 6 h window can therefore satisfy the first condition on its own. Across two
  years this never produced a non-outage alert (the PV and tank gates suppressed it), so no
  minimum-sample condition was added; `boiler-temperature-sensor-failure` is the dedicated owner of
  "`xymd1` has gone quiet".

## Data Sources

### InfluxDB Measurements
- `automation_status` - Controller decisions and state (automation-events-processor). **Being written**;
  verified 2026-08-09: 1101 points for `service='boilerController'` in the preceding 7 days, most
  recent at `2026-08-09T11:39:16Z`. An earlier note here claimed the measurement was unavailable due
  to InfluxDB authentication errors - that is no longer true. Note `reason` and `controlMode` are
  **tags**, not fields: filter on them, but count a real field.
- `inverter` - PV inverter output (compose service `inverter` → Huawei SUN2000, `device.name='main'`).
  `ap` is instantaneous AC power in **kW** (`sun2000.js` divides the raw register by 1000); used as the
  "is the sun out" gate by both solar circuit alerts. Published on change with `maxMsBetweenReports`
  5 min, so its point density varies with daylight — see the time-weighting caveat above.
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