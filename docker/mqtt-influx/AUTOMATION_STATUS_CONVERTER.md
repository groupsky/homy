# Automation Status Converter

## Overview

The automation-status converter bridges automation system status messages from MQTT to InfluxDB for monitoring and analysis. This converter specifically handles status messages from automation controllers like the boiler controller.

## Features

- **Source of Truth Data**: Stores controller decisions and modes
- **Correlation Data**: Stores controller's view of sensors for debugging
- **Comprehensive Validation**: Ensures data quality before storage
- **Full Test Coverage**: 100% test coverage with TDD implementation

## Data Flow

```
Automation Controller → MQTT Topic → mqtt-influx Service → InfluxDB
                     (homy/automation/+/status)         (automation_status measurement)
```

## InfluxDB Schema

### Measurement: `automation_status`

**Tags:**
- `service`: Controller name (e.g., "boiler_controller")
- `type`: Always "status"

**Fields (Controller Decisions - Source of Truth):**
- `reason` (string): Decision reasoning (e.g., "comfort_heating_top_45.2C")
- `controlMode` (string): Current mode ("automatic", "manual_on", "vacation_7d", etc.)
- `manualOverrideExpires` (integer): Timestamp when manual mode expires (optional)

**Fields (Controller View - For Correlation):**
- `heaterState` (boolean): Controller's intended relay state
- `solarCirculation` (boolean): Solar pump state as seen by controller
- `temp_top_seen` (float): Top temperature as seen by controller
- `temp_bottom_seen` (float): Bottom temperature as seen by controller
- `temp_solar_seen` (float): Solar temperature as seen by controller
- `temp_ambient_seen` (float): Ambient temperature as seen by controller

## Message Format

### Input (MQTT Topic: `homy/automation/boiler_controller/status`)

```json
{
  "_type": "automation-status",
  "reason": "comfort_heating_top_45.2C",
  "controlMode": "automatic",
  "manualOverrideExpires": null,
  "heaterState": true,
  "solarCirculation": false,
  "temperatures": {
    "top": 45.2,
    "bottom": 42.8,
    "solar": 38.1,
    "ambient": 26.9
  },
  "_bot": {
    "name": "boiler_controller",
    "type": "boiler-controller"
  },
  "_tz": 1726325400000
}
```

### Output (InfluxDB Point)

```
automation_status,service=boiler_controller,type=status reason="comfort_heating_top_45.2C",controlMode="automatic",heaterState=T,solarCirculation=F,temp_top_seen=45.2,temp_bottom_seen=42.8,temp_solar_seen=38.1,temp_ambient_seen=26.9 1726325400000
```

## Use Cases

### Grafana Dashboards

```sql
-- Controller decision analysis
SELECT reason, controlMode, heaterState FROM automation_status
WHERE "service"='boiler_controller'
AND time > now() - 24h

-- Temperature correlation analysis
SELECT temp_top_seen, temp_bottom_seen, reason FROM automation_status
WHERE "service"='boiler_controller'
AND controlMode='automatic'
AND time > now() - 7d
```

### Monitoring Alerts

- **Manual mode too long**: `manualOverrideExpires` approaching expiry
- **Frequent heating cycles**: Rapid changes in `heaterState`
- **Temperature correlation issues**: Differences between controller view and actual sensors

## Supported Control Modes

- `automatic`: Normal automatic operation
- `manual_on`: Manual heating enabled
- `manual_off`: Manual heating disabled
- `vacation_3d` through `vacation_14d`: Vacation modes with automatic expiry

## Error Handling

The converter includes comprehensive error handling:
- Returns empty array for malformed input
- Validates required fields (`reason`, `controlMode`, `_tz`)
- Gracefully handles missing optional fields
- Type validation for all data fields

## Testing

### Run Tests
```bash
npm test
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Test Structure
- **Unit Tests**: `automation-status.test.js` - Comprehensive converter testing
- **Integration Tests**: `integration.test.js` - Service integration verification
- **End-to-End Tests**: `message-processing.test.js` - Complete flow simulation

## Deployment

### Docker Service Configuration

Add to docker-compose.yml:

```yaml
mqtt-influx-automation-status:
  build: docker/mqtt-influx
  environment:
    - BROKER=mqtt://broker
    - TOPIC=homy/automation/+/status
    - MQTT_CLIENT_ID=mqtt-influx-automation-status
    - INFLUXDB_URL=http://influxdb:8086
    - INFLUXDB_DATABASE=homy
    - INFLUXDB_USERNAME=writer
    - INFLUXDB_PASSWORD_FILE=/run/secrets/influxdb_write_user_password
  secrets:
    - influxdb_write_user_password
  depends_on:
    - broker
    - influxdb
```

### Required Configuration

The boiler controller (or other automation services) must publish messages with:
1. `_type: "automation-status"` field for converter routing
2. All required fields: `reason`, `controlMode`, `_tz`
3. Proper topic format: `homy/automation/{service}/status`

## Implementation Details

### TDD Implementation

This converter was implemented using Test-Driven Development:
1. **Red Phase**: Write failing tests defining expected behavior
2. **Green Phase**: Implement minimal code to make tests pass
3. **Refactor Phase**: Improve code quality while maintaining tests

### Data Separation Philosophy

The converter maintains clear separation between:
- **Authoritative Data**: Controller decisions stored as source of truth
- **Correlation Data**: Controller's sensor view for debugging and correlation
- **External Data**: Actual sensor readings stored separately in existing measurements

This design enables:
- Troubleshooting when controller decisions don't match sensor data
- Performance analysis of automation logic
- Historical analysis of decision patterns and effectiveness