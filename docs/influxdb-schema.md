# InfluxDB Schema Documentation

This document provides comprehensive documentation of all data stored in the InfluxDB time-series database.

## Database Overview

- **Database**: `homy`
- **Host**: localhost:8086
- **Access**: Credentials managed through Docker secrets
- **Retention**: Historical data available back to 2022
- **Resolution**: Sub-second to minute-level intervals depending on data source

## Data Sources and Services

### Direct InfluxDB Writers
- **modbus-serial services**: Write device readings directly to InfluxDB
- **mqtt-influx services**: Convert MQTT messages to InfluxDB points
- **sunseeker-monitoring**: Specialized monitoring service with own mqtt-influx integration

### MQTT Bridge Services
- **mqtt-influx-primary**: `/modbus/main/+/+` → InfluxDB
- **mqtt-influx-secondary**: `/modbus/secondary/+/+` → InfluxDB
- **mqtt-influx-tetriary**: `/modbus/tetriary/+/+` → InfluxDB

## Measurements and Schema

### `raw` Measurement
**Source**: Secondary Modbus Bus (mqtt-influx-secondary)
**Tag Structure**:
- `bus: "secondary"`
- `device`: Device identifier (e.g., "boiler")

**Fields** (from DDS519MR energy meter at address 20):
- `tot` (float): Total energy consumption (kWh)
- `v` (float): Voltage
- `c` (float): Current
- `p` (float): Power
- `pf` (float): Power factor
- `freq` (float): Frequency

**Use Cases**: Boiler electric heater energy monitoring, consumption analysis

### `xymd1` Measurement
**Source**: Solar Controller Modbus Bus (monitoring)
**Tag Structure**:
- `bus: "monitoring"`
- `device`: "solar_heater"

**Temperature Fields** (°C):
- `t1` (float): Boiler bottom temperature
- `t2` (float): Boiler top temperature
- `t3` (float): Solar panel temperature
- `t4` (float): Heat installation temperature
- `t5` (float): Additional temperature sensor
- `t6` (float): Service room ambient temperature
- `t7`, `t8` (float): Additional temperature sensors

**Control State Fields**:
- `outputs.p1` (boolean): Solar circulation pump status
- `outputs.p6` (boolean): Electric heater flag (⚠️ misconfigured - ignore)

**Use Cases**: Temperature monitoring, solar heating coordination, thermal analysis

### `inverter` Measurement
**Source**: Inverter TCP Connection
**Tag Structure**:
- `bus: "inverter"`

**Fields**:
- `total_p` (float): Accumulated solar PV energy production (kWh)

**Use Cases**: Solar PV production monitoring (separate from thermal system)

## Data Quality Notes

### Reliable Data Sources
- ✅ Boiler energy consumption (`raw` measurement)
- ✅ Temperature sensors (`xymd1` measurement)
- ✅ Solar circulation pump status
- ✅ Solar PV production data

### Data to Ignore
- ❌ `outputs.p6` (solar_heater_electric_heater flag) - Misconfigured
- ⚠️ Solar PV data not directly applicable to boiler heating (different electrical network)

## Query Examples

### Energy Consumption Analysis
```sql
SELECT tot FROM raw
WHERE bus='secondary' AND device='boiler'
AND time > now() - 7d
```

### Temperature Monitoring
```sql
SELECT t1, t2, t3, t6 FROM xymd1
WHERE bus='monitoring'
AND time > now() - 24h
```

### Solar System Coordination
```sql
SELECT t2, t3, "outputs.p1" FROM xymd1
WHERE bus='monitoring'
AND time > now() - 1h
```

## Integration Points

### Home Assistant
Home Assistant entities map to InfluxDB data:
- `sensor.boiler_energy_used` → `raw.tot`
- `sensor.temperature_boiler_high` → `xymd1.t2`
- `sensor.temperature_boiler_low` → `xymd1.t1`
- `sensor.temperature_solar_panel` → `xymd1.t3`
- `binary_sensor.solar_heater_circulation` → `xymd1.outputs.p1`

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
- Use appropriate time ranges in queries to avoid large dataset scans
- Leverage tags for filtering (indexed)
- Fields are not indexed - avoid WHERE clauses on field values
- Consider downsampling for long-term trend analysis

## Future Enhancements

### Planned Additions
- Automation system status data (controller decisions, modes)
- Feature state tracking (relay states, sensor readings)
- Enhanced monitoring for new devices and systems

### Schema Evolution
When adding new measurements:
1. Document schema in this file
2. Update relevant service CLAUDE.md files
3. Consider tag cardinality and retention policies
4. Plan Grafana dashboard integration