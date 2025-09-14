# CLAUDE.md - Modbus Serial Service

This file provides guidance specific to the modbus-serial service for Claude Code.

## Service Overview

The modbus-serial service reads data from Modbus RTU/TCP devices and writes directly to InfluxDB. Multiple instances handle different modbus buses and device types.

## Architecture

### Service Instances
Multiple modbus-serial services run for different buses:
- **Primary Bus**: Main electrical monitoring
- **Secondary Bus**: Boiler and secondary circuits
- **Solar Bus**: Solar heater controller (Microsyst SR-04)
- **Inverter Bus**: Solar PV inverter (TCP connection)

### Data Flow
```
Modbus Device → Serial/TCP → Device Driver → InfluxDB Direct Write
```

## InfluxDB Integration

### Data Storage
This service writes directly to InfluxDB (not through mqtt-influx). See **[InfluxDB Schema Documentation](../../docs/influxdb-schema.md)** for complete data structure.

**Key Measurements Written:**
- `raw` - Energy meter data from secondary bus (boiler consumption)
- `xymd1` - Temperature and control data from solar controller
- `inverter` - Solar PV production data

### **IMPORTANT: Schema Updates**
When modifying this service's InfluxDB writes:
1. **Update [InfluxDB Schema Documentation](../../docs/influxdb-schema.md)**
2. **Test with existing Grafana dashboards**
3. **Verify Home Assistant entity mappings**
4. **Consider data continuity for historical analysis**

## Device Integration

### Supported Device Types
- **DDS519MR**: Energy meter (secondary bus, boiler monitoring)
- **Microsyst SR-04**: Solar controller (temperature sensors, pump control)
- **Huawei SUN2000**: Solar inverter (PV production)
- Various energy meters (DDS024MR, EX9EM, SDM630, etc.)

### Device Drivers
Device-specific drivers in `devices/` directory:
- Transform raw Modbus data to structured format
- Handle device-specific register mapping
- Provide data validation and error handling

## Configuration

### Environment Variables
- **MODBUS_DEVICE**: Device path or TCP connection
- **CONFIG_FILE**: Device configuration file path
- **INFLUXDB_***: InfluxDB connection settings
- **Bus-specific settings**: Varies by instance

### Device Configuration
Device configurations in `config/modbus-serial/`:
- Register mappings
- Data types and transformations
- Polling intervals
- Device addresses

## Development Guidelines

### Adding New Devices
1. Create device driver in `devices/` directory
2. Add configuration to appropriate config file
3. **Update [InfluxDB Schema Documentation](../../docs/influxdb-schema.md)**
4. Test with existing monitoring infrastructure

### Data Quality
- Implement proper error handling for device communications
- Validate data ranges and types before InfluxDB writes
- Handle device offline scenarios gracefully
- Log meaningful error messages for debugging

### Integration Testing
```bash
# Test device communication
node cli/test-device.js

# Verify InfluxDB writes
# Check docs/influxdb-schema.md for query examples

# Test configuration
npm test
```

## Monitoring and Debugging

### Health Checks
Monitor service health through:
- Modbus communication status logs
- InfluxDB write success/failure rates
- Device-specific data validation errors

### Common Issues
1. **Serial port access**: Ensure proper permissions for device files
2. **Device timeouts**: Check bus configuration and wiring
3. **InfluxDB connection**: Verify credentials and network connectivity
4. **Data validation**: Check device driver register mappings

### Debugging
```bash
# View service logs
docker compose logs -f modbus-serial-secondary

# Test device connectivity
docker exec -it modbus-serial-secondary node cli/test-connection.js

# Verify InfluxDB data
# Use queries from docs/influxdb-schema.md
```

## Performance Considerations

### Polling Strategy
- Balance between data freshness and device load
- Use appropriate intervals for different data types
- Implement backoff strategies for communication failures

### InfluxDB Performance
- Write data points efficiently
- Use appropriate data types (float vs int)
- Consider retention policies for high-frequency data
- Monitor database performance impact

## Integration Points

### Home Assistant
Many Home Assistant entities depend on modbus-serial data:
- Energy sensors (from `raw` measurement)
- Temperature sensors (from `xymd1` measurement)
- Control state monitoring

### Grafana Dashboards
Modbus data feeds into multiple Grafana dashboards:
- Energy monitoring
- Temperature trending
- System status overview

### Automation Services
Automation bots subscribe to topics that may correlate with modbus data:
- Boiler controller uses temperature data
- Energy monitoring for optimization decisions

## Best Practices

### Data Integrity
1. **Validate all sensor readings** before writing to InfluxDB
2. **Handle communication errors** gracefully without stopping service
3. **Log meaningful context** for debugging communication issues
4. **Test device drivers** thoroughly with actual hardware

### Configuration Management
1. **Version control all device configs** in git
2. **Document register mappings** clearly in config files
3. **Use environment variables** for deployment-specific settings
4. **Validate configurations** on service startup

### Schema Evolution
1. **Always update schema documentation** when changing data structure
2. **Test backward compatibility** with existing queries
3. **Plan migrations** for breaking changes
4. **Coordinate with downstream consumers** (Grafana, Home Assistant)

## Service-Specific Notes

### Bus Separation
Different modbus instances handle different device groups:
- **Secondary Bus**: Critical for boiler energy monitoring
- **Solar Bus**: Temperature sensors and pump control
- **Inverter Bus**: PV production (separate electrical network)

### Data Reliability
The modbus-serial service provides authoritative data for:
- ✅ Energy consumption measurements
- ✅ Temperature sensor readings
- ✅ Device control states
- ✅ Solar production data

This data is the source of truth for system monitoring and automation decisions.