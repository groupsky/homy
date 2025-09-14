# CLAUDE.md - Automation Events Processor

This file provides guidance specific to the automation-events-processor service for Claude Code.

## Service Overview

The automation-events-processor is a dedicated event sourcing service that processes home automation decision events from MQTT and stores them in InfluxDB for monitoring and analysis.

**Event Sourcing Architecture:**
- **Single Event Type**: Processes only automation decision events from `homy/automation/+/status`
- **Source of Truth**: Captures controller decisions, control modes, and override states
- **Correlation Data**: Records controller's view of sensors at decision time
- **Domain-Specific**: Understands automation decision semantics and business logic

## Quick Commands

### Development
```bash
# Run tests
cd docker/automation-events-processor
npm test

# Run with coverage
npm run test -- --coverage

# Watch mode during development
npm run test:watch

# Start service locally
npm start
```

### Docker Development
```bash
# Build and run the service
docker compose up -d --build automation-events-processor

# View logs
docker compose logs -f automation-events-processor

# Test the service
docker compose exec automation-events-processor npm test
```

## Architecture

### Event Processing Flow
```
Automation Bots → MQTT (homy/automation/+/status) → Event Processor → InfluxDB (automation_status) → Grafana
```

### Event Schema
The service processes automation decision events with this structure:
```javascript
{
  // Framework metadata (added automatically)
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000,

  // Decision data (source of truth)
  reason: 'comfort_heating_top_45.2C',
  controlMode: 'automatic',
  manualOverrideExpires: null,

  // Controller state (correlation data)
  heaterState: true,
  solarCirculation: false,
  temperatures: {
    top: 45.2,
    bottom: 42.8,
    solar: 38.1,
    ambient: 26.9
  }
}
```

### InfluxDB Output
Events are transformed into InfluxDB points with:
- **Measurement**: `automation_status`
- **Tags**: `service` (bot name), `type` (status)
- **Fields**: Decision data, state data, temperature readings
- **Timestamp**: Event timestamp from `_tz` field

For comprehensive InfluxDB schema documentation including all measurements and data sources, see **[InfluxDB Schema Documentation](../../docs/influxdb-schema.md)**.

## Development Guidelines

### Adding Support for New Automation Bots

The service automatically handles events from any automation bot that publishes to `homy/automation/{bot_name}/status`. No code changes needed for new bots.

**Requirements for automation bots:**
1. Publish to `homy/automation/{bot_name}/status`
2. Include required fields: `reason`, `controlMode`, `_tz`, `_bot.name`
3. Follow the event schema structure

### Event Validation

The service validates all incoming events:
- **Required fields**: `_bot.name`, `reason`, `controlMode`, `_tz`
- **Optional fields**: `manualOverrideExpires`, `heaterState`, `solarCirculation`, `temperatures`
- **Error handling**: Invalid events are logged and skipped without stopping processing

### Field Type Mapping

| Event Field | InfluxDB Type | Format | Example |
|-------------|---------------|---------|---------|
| reason | stringField | `"value"` | `"comfort_heating_top_45.2C"` |
| controlMode | stringField | `"value"` | `"automatic"` |
| manualOverrideExpires | intField/stringField | `123i` or `"null"` | `1726411800000i` |
| heaterState | booleanField | `T`/`F` | `T` |
| temperatures.* | floatField | `45.2` | `45.2` |

## Testing

### Test Structure
- **Unit Tests**: `automation-events.test.js` - Core event processing logic
- **Integration Tests**: `integration.test.js` - End-to-end message handling
- **Test Constants**: `test-constants.js` - Realistic test data

### Test Coverage
The service has comprehensive test coverage for:
- ✅ All automation bot types and decision scenarios
- ✅ Event validation and error handling
- ✅ Field type conversion and InfluxDB formatting
- ✅ Invalid and malformed event handling
- ✅ Integration with MQTT and InfluxDB clients

### Running Tests
```bash
# All tests
npm test

# Specific test file
npx jest automation-events.test.js

# Watch mode
npm run test:watch

# Coverage report
npm test -- --coverage
```

## Configuration

### Environment Variables
- **BROKER**: MQTT broker URL (default: `mqtt://broker`)
- **TOPIC**: MQTT topic pattern (default: `homy/automation/+/status`)
- **MQTT_CLIENT_ID**: MQTT client identifier (default: `automation-events-processor`)
- **INFLUXDB_URL**: InfluxDB connection URL
- **INFLUXDB_DATABASE**: Target database name
- **TAGS**: Additional tags as JSON string (optional)

### Docker Secrets
- **influxdb_write_user**: InfluxDB username file
- **influxdb_write_user_password**: InfluxDB password file

## Monitoring and Troubleshooting

### Health Checks
Monitor service health through:
- MQTT connection status in logs
- InfluxDB write success/failure messages
- Event processing counts and invalid event warnings

### Common Issues

**No events being processed:**
- Check MQTT broker connection
- Verify topic subscription pattern matches bot publications
- Ensure automation bots are publishing to correct topics

**InfluxDB write failures:**
- Verify InfluxDB connection and credentials
- Check database exists and write permissions
- Monitor InfluxDB logs for detailed error information

**Invalid events being rejected:**
- Review bot event schema - ensure required fields are present
- Check `_bot` metadata is being added by automation framework
- Verify timestamp field (`_tz`) is included

### Debugging
```bash
# View service logs
docker compose logs -f automation-events-processor

# Test MQTT subscription manually
mosquitto_sub -h broker -t "homy/automation/+/status"

# Check InfluxDB data
influx -database homy -execute "SELECT * FROM automation_status ORDER BY time DESC LIMIT 10"

# View processed events in Grafana
# Use automation_status measurement with service and type tags
```

## Performance Considerations

### Scalability
- **Event Volume**: Designed for automation decision events (low-medium frequency)
- **Memory Usage**: Minimal state - processes events as they arrive
- **InfluxDB Writes**: Individual point writes per event (suitable for decision event frequency)

### Optimization Guidelines
- Monitor InfluxDB write performance under load
- Consider batching if event volume increases significantly
- Use appropriate InfluxDB retention policies for historical data

## Integration with Other Services

### Grafana Dashboards
Query automation decisions using:
```sql
SELECT reason, controlMode, heaterState
FROM automation_status
WHERE service = 'boiler_controller'
AND time > now() - 24h
```

### Home Assistant
Events are stored in InfluxDB and can be accessed through:
- InfluxDB sensor platform for current states
- History queries for decision analysis
- Automation triggers based on decision patterns

### Alert Rules
Configure Grafana alerts for:
- Automation failures or repeated error decisions
- Manual override patterns indicating system issues
- Decision frequency anomalies

## Best Practices

### Development
1. **Event Schema**: Follow established event structure for consistency
2. **Testing**: Write tests for new event scenarios before implementation
3. **Error Handling**: Gracefully handle malformed events without service interruption
4. **Logging**: Provide clear, actionable log messages for debugging

### Production
1. **Monitoring**: Set up alerts for service health and event processing issues
2. **Resource Limits**: Configure appropriate Docker resource constraints
3. **Log Management**: Use structured logging for operational visibility
4. **Backup Strategy**: Ensure InfluxDB data is included in backup procedures

### Event Sourcing Principles
1. **Immutable Events**: Never modify processed events - store exactly as received
2. **Single Responsibility**: Process only automation decision events
3. **Correlation vs Source**: Distinguish between controller decisions (source) and sensor readings (correlation)
4. **Event Ordering**: Preserve event timestamps for accurate historical analysis

## Documentation Maintenance

### Schema Changes
**IMPORTANT**: When making changes to the automation_status measurement or adding new automation bots that publish different event schemas:

1. **Update InfluxDB Schema**: Modify `../../docs/influxdb-schema.md` to reflect changes in:
   - Measurement fields and their types
   - Tag structures and cardinality
   - New automation bot types and their event patterns
   - Query examples and use cases

2. **Update This Documentation**: Update this CLAUDE.md file to reflect:
   - New event schema structures
   - Additional field type mappings
   - New automation bot requirements
   - Updated query examples

3. **Test Schema Changes**: Verify that:
   - All existing Grafana dashboards continue to work
   - InfluxDB queries in documentation remain valid
   - Event validation covers new schema elements

4. **Cross-Reference Updates**: Ensure consistency between:
   - This service documentation
   - InfluxDB schema documentation
   - Grafana dashboard configurations
   - Home Assistant integration examples