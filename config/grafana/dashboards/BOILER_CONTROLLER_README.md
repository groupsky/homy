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

The dashboard integrates with 7 automated alert rules:

### Critical Alerts
1. **Boiler Overheating** - Temperature >85°C for 2+ minutes
2. **Controller Not Responding** - No decisions for 30+ minutes
3. **Temperature Sensor Failure** - No readings for 30+ minutes

### High Priority Alerts
4. **Emergency Heating Active** - Critical low temperature for 10+ minutes
5. **Excessive Power** - >3kW consumption for 15+ minutes

### Warning Alerts
6. **Manual Mode Extended** - Manual override for 2+ hours
7. **Solar Circulation Stuck** - No state changes for 1+ hour

## Data Sources

### InfluxDB Measurements
- `automation_status` - Controller decisions and state (automation-events-processor) - **Currently unavailable due to authentication issues**
- `xymd1` - Temperature sensors and relay controls (modbus-serial-monitoring)
  - Temperature data: `solar_heater` device (t1, t2, t3, t6)
  - Solar circulation pump: `solar_heater` device (outputs.p1)
  - Irrigation relays: `controlbox` device (outputs.p1-p8, relays32-47)
- `raw` - Boiler power consumption (modbus-serial-secondary → DDS519MR meter)

### Query Patterns
```sql
-- Controller decisions (currently unavailable)
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
3. **Missing Decision Data**: automation-events-processor has authentication issues with InfluxDB
4. **Alert Not Firing**: Some alerts disabled due to missing automation_status measurement
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