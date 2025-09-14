# CLAUDE.md - MQTT-InfluxDB Bridge Service

This file provides guidance specific to the mqtt-influx service for Claude Code.

## Service Overview

The mqtt-influx service bridges MQTT messages to InfluxDB time-series storage. Multiple instances handle different data streams, with specialized converters transforming MQTT payloads into InfluxDB points.

## Architecture

### Service Instances
- **mqtt-influx-primary**: Primary electrical monitoring bus (`/modbus/main/+/+`)
- **mqtt-influx-secondary**: Secondary circuits and boiler monitoring (`/modbus/secondary/+/+`)
- **mqtt-influx-tetriary**: Additional power monitoring points (`/modbus/tetriary/+/+`)
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
- **dds024mr**: DDS024MR energy meter data
- **dds519mr**: DDS519MR energy meter data
- **ex9em**: EX9EM energy meter data
- **or-we-514**: OR-WE-514 energy meter data
- **sdm630**: SDM630 three-phase energy meter data
- **automation-status**: Automation system status and decisions (comprehensive TDD implementation)

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

### Featured Implementation: Automation Status Converter

The **automation-status** converter demonstrates best practices for mqtt-influx development:
- **TDD Implementation**: Complete test-driven development with 100% coverage
- **Data Separation**: Clear distinction between source-of-truth and correlation data
- **Comprehensive Testing**: Unit, integration, and end-to-end test suites
- **Production Ready**: Full error handling and validation

See **[Automation Status Converter Documentation](./AUTOMATION_STATUS_CONVERTER.md)** for detailed implementation guide.

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
- **TOPIC**: MQTT topic pattern to subscribe to (supports wildcards)
- **MQTT_CLIENT_ID**: Unique client identifier
- **INFLUXDB_URL**: InfluxDB connection URL
- **INFLUXDB_DATABASE**: Database name
- **TAGS**: Default tags as JSON string

### Docker Secrets
- **influxdb_write_user**: InfluxDB username file
- **influxdb_write_user_password**: InfluxDB password file

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
