# CLAUDE.md - MQTT-InfluxDB Bridge Service

This file provides guidance specific to the mqtt-influx service for Claude Code.

## Service Overview

The mqtt-influx service bridges MQTT messages to InfluxDB time-series storage. Multiple instances handle different data streams, with specialized converters transforming MQTT payloads into InfluxDB points.

## Architecture

### Service Instances
- **mqtt-influx-primary**: Primary electrical monitoring bus (`/modbus/main/+/+`)
- **mqtt-influx-secondary**: Secondary circuits and boiler monitoring (`/modbus/secondary/+/+`)
- **mqtt-influx-tetriary**: Additional power monitoring points (`/modbus/tetriary/+/+`)
- **mqtt-influx-dry-switches**: Digital I/O bus (`/modbus/dry-switches/+/reading`) — decomposes packed input/output words into per-bit boolean fields for contact-sensor and RS485 bus-health diagnostics
- **mqtt-influx-ioniq**: Hyundai Ioniq OBD telemetry (`ioniq/parsed/#`) → `ioniq` measurement
- **mqtt-influx-ioniq-sessions**: Ioniq session records from the `ioniq-sessions` automations bot (`ioniq/derived/#`) → `ioniq_sessions` measurement (one record per closed trip/charge/park session)
- **mqtt-influx-zigbee**: Zigbee mesh via zigbee2mqtt (`z2m/house1/+` and `z2m/house1/+/availability`) → `zigbee` measurement. Uses `CONVERTER=zigbee` rather than payload dispatch, because zigbee2mqtt does not stamp a `_type` into its payloads
- **Water System Integration**: See `docs/water_system_spec.md` for complete MQTT topic mappings for pumps, boiler, and heat pump energy monitoring

### Data Flow
```
MQTT Message → Converter → InfluxDB Points → InfluxDB Storage → Grafana Visualization
```

## Converter Development

### Converter Pattern
Each converter transforms MQTT messages based on the `_type` field:

```javascript
const {Point} = require('@influxdata/influxdb-client')

module.exports = (data) => {
    const points = []
    
    if (data.type === 'specific_event_type') {
        const point = new Point('measurement_name')
            .tag('tag_key', data.tagValue)
            .intField('field_name', data.fieldValue)
            .timestamp(new Date(data.timestamp))
        
        points.push(point)
    }
    
    return points
}
```

### Existing Converters
- **aspar-mod-16ro**: Aspar MOD-16RO relay module — per-relay boolean states + RS485 packet counters (`dry_switch_relay`)
- **dds024mr**: DDS024MR energy meter data
- **dds519mr**: DDS519MR energy meter data  
- **ex9em**: EX9EM energy meter data
- **ioniq**: Hyundai Ioniq OBD telemetry — recursively-typed/flattened parsed frames into the `ioniq` measurement (tags `group`, `state`)
- **ioniq-session**: Ioniq session records (`_type: 'ioniq-session'`) — one closed trip/charge/park record per emit into the `ioniq_sessions` measurement (tag `kind`; timestamp `start_ts`; `end_ts` and all other §4 metrics as typed fields, null metrics omitted)
- **mbsl32di**: MBSL32DI digital-input module — raw word + per-input boolean fields (`dry_switch_input`)
- **or-we-514**: OR-WE-514 energy meter data
- **sdm630**: SDM630 three-phase energy meter data
- **zigbee**: zigbee2mqtt device state and availability → `zigbee` measurement (tag `device` = friendly name from the topic, plus `mesh` from `TAGS`). Flattens attributes like `ioniq` does; adds boolean `state_on` for ON/OFF devices and numeric `last_seen_ms`. **Drops any message whose device segment is an IEEE address** — see the privacy note below

## Adding New Converters

### Step 1: Create Converter File
Create a new file in `converters/` directory:

```javascript
// converters/my-new-converter.js
const {Point} = require('@influxdata/influxdb-client')

module.exports = (data) => {
    const points = []
    
    // Transform data based on message type
    if (data.type === 'my_event_type') {
        const point = new Point('my_measurement')
            .tag('device', data.device)
            .floatField('value', data.value)
            .timestamp(new Date(data.timestamp))
        
        points.push(point)
    }
    
    return points
}
```

### Step 2: Register Converter
Add to `index.js` converters object:

```javascript
const converters = {
    // existing converters...
    'my-new-type': require('./converters/my-new-converter'),
}
```

### Step 3: Configure Service
Add or modify docker-compose.yml service:

```yaml
mqtt-influx-my-service:
  build: docker/mqtt-influx
  environment:
    - TOPIC=my/mqtt/topic/pattern
    - MQTT_CLIENT_ID=mqtt-influx-my-service
    # other configuration...
```

## Data Types and Measurements

For comprehensive InfluxDB schema documentation including all measurements, fields, and data sources, see **[InfluxDB Schema Documentation](../../docs/influxdb-schema.md)**.

### InfluxDB Point Structure
- **Measurement**: The InfluxDB table name (e.g., 'command_failure', 'energy_reading')
- **Tags**: Indexed metadata for filtering (device, controller, reason)
- **Fields**: Actual data values (attempts, power, voltage)
- **Timestamp**: Time point for the measurement

### Field Type Guidelines
- **intField**: Counters, attempts, discrete values
- **floatField**: Sensor readings, percentages, calculated values
- **booleanField**: On/off states, status flags
- **stringField**: Avoid for high-cardinality data (use tags instead)

### Tag Design Principles
- Use tags for data you'll filter or group by in Grafana
- Keep tag cardinality reasonable (< 100k unique combinations)
- Common tags: device, controller, location, type

## Configuration

### Environment Variables
- **BROKER**: MQTT broker URL (e.g., `mqtt://broker`)
- **TOPIC**: MQTT topic pattern(s) to subscribe to (supports wildcards). **Comma-separated for more than one** — needed when a producer splits a device across topics, as zigbee2mqtt does with state and availability
- **CONVERTER**: optional. When set, every message on `TOPIC` goes to this one converter, which receives `(payload, topic)`. Required for producers that do not stamp `_type` into the payload — anything not written by this project. Unset keeps the original `data._type` dispatch, which is what the five Modbus/Ioniq instances use
- **MQTT_CLIENT_ID**: Unique client identifier
- **INFLUXDB_URL**: InfluxDB connection URL
- **INFLUXDB_DATABASE**: Database name
- **TAGS**: Default tags as JSON string

### Docker Secrets
- **influxdb_write_user**: InfluxDB username file
- **influxdb_write_user_password**: InfluxDB password file

## Privacy: IEEE addresses must never be written

**This repository is public and `CLAUDE.md` forbids MAC addresses in it. A
Zigbee IEEE address is an EUI-64 — a MAC address.**

zigbee2mqtt defaults a device's `friendly_name` to its IEEE address, so a
device that has never been named publishes on
`<base_topic>/0x................/availability`. The obvious implementation of
a Zigbee bridge — take the device name from the topic — therefore writes a MAC
as an InfluxDB tag value, from where it reaches every dashboard and export.
This is not hypothetical: on 2026-09-01, one of the nine devices on the
`house1` mesh was in exactly that state.

`converters/zigbee.js` drops such messages and logs a warning, rather than
substituting a placeholder — a placeholder would silently merge every unnamed
device into one series and hide that a device is going unrecorded. The rule is
enforced by tests in `converters/__tests__/zigbee.test.js`, including one that
asserts no emitted point's line protocol can ever match an IEEE address.

**To record such a device, give it a `friendly_name` in zigbee2mqtt.** It then
starts recording on its next message with no change here.

## Monitoring and Debugging

### Health Checks
Monitor service health through:
- MQTT connection status logs
- InfluxDB write errors
- Message processing rate

### Common Issues
1. **Unhandled type warnings**: Add converter for new `_type` values
2. **InfluxDB write failures**: Check credentials and database existence
3. **High memory usage**: Review tag cardinality and data retention

### Debugging
```bash
# View service logs
docker compose logs -f mqtt-influx-automation

# Test MQTT subscription
mosquitto_sub -h broker -t "homy/automation/+/command_failed"

# Check InfluxDB data
influx -database automation -execute "SHOW MEASUREMENTS"
```

## Performance Considerations

### Batch Processing
- The service writes points individually as received
- For high-throughput scenarios, consider batching writes
- Monitor InfluxDB performance and adjust retention policies

### Memory Management
- Converters should return points promptly
- Avoid storing large amounts of state in memory
- Let InfluxDB handle data aggregation and retention

### MQTT Topic Patterns for mqtt-influx

Standard patterns this service handles:
- `/modbus/{bus}/{device}/reading` - Device status readings from modbus services

## Integration with Grafana

### Query Patterns
Data written by mqtt-influx services can be queried in Grafana

### Dashboard Integration
- Use measurement names as the basis for Grafana queries
- Tags become available as GROUP BY options
- Fields become selectable metrics

## Best Practices

### Converter Design
1. **Single responsibility**: Each converter handles one data type
2. **Error handling**: Return empty array for unknown message types
3. **Consistent naming**: Use descriptive measurement and field names
4. **Tag efficiency**: Use tags for filtering, fields for values

### Message Format
MQTT messages should include:
```javascript
{
    _type: 'converter-name',        // Required: determines which converter to use
    type: 'specific_event_type',    // Event subtype within converter
    timestamp: Date.now(),          // Timestamp for the event
    // additional data fields...
}
```

### Deployment
- Test converters with sample data before deployment
- Monitor InfluxDB storage growth after adding new converters
- Use appropriate retention policies for different data types
- Consider data compression for high-frequency measurements
