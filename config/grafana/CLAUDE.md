# CLAUDE.md - Grafana Configuration

This directory contains Grafana configuration, dashboards, and provisioning for the home automation monitoring system.

## Directory Structure

- `config.ini` - Main Grafana configuration
- `dashboards/` - Dashboard JSON definitions
- `provisioning/` - Auto-provisioning configurations
  - `alerting/` - Alert rules and notification configurations
  - `dashboards/` - Dashboard provisioning settings
  - `datasources/` - Data source configurations
  - `plugins/` - Plugin configurations

## Dashboard Development

### Dashboard Standards

**Panel Types and Usage:**
- **Stat panels**: Current values, status indicators, key metrics
- **Timeseries panels**: Trend visualization, historical data analysis  
- **Table panels**: Detailed data views, logs, event listings
- **Gauge panels**: Percentage values, thresholds (battery levels, temperatures)

**Time Ranges:**
- **Overview dashboards**: Last 24 hours default, 7 days max
- **Detail dashboards**: Last 6 hours default, 24 hours max
- **Historical analysis**: Last 30 days default, custom ranges available

**Refresh Intervals:**
- **Real-time monitoring**: 5s-30s for active monitoring
- **General dashboards**: 1m-5m for regular use
- **Historical dashboards**: 1h for analysis views

### Dashboard Navigation

**Connected Dashboards:**
- Use dashboard links panel for navigation between related views
- Implement consistent navigation patterns across dashboard families
- Provide both overview → detail and detail → overview navigation paths

**URL Parameters:**
- Use consistent variable names across dashboards (e.g., `device_id`, `time_range`)
- Include device/service selection variables where applicable
- Enable variable persistence for user convenience

### Data Source Integration

**InfluxDB Queries:**
```flux
from(bucket: "home_automation")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "sunseeker_mode")
  |> filter(fn: (r) => r["device_id"] == "${device_id}")
  |> aggregateWindow(every: v.windowPeriod, fn: last, createEmpty: false)
```

**Best Practices:**
- Use appropriate time aggregation (`aggregateWindow`) for performance
- Filter by measurement and device_id early in queries
- Use dashboard variables for dynamic filtering
- Implement proper null handling with `createEmpty: false`

### Alerting Integration

**Alert Rule Organization:**
- Group related alerts in single YAML files (e.g., `sunseeker-alerts.yaml`)
- Use descriptive alert names and labels
- Include recovery conditions for all alerts

**Notification Configuration:**
```yaml
- uid: sunseeker_battery_low
  title: "Sunseeker Battery Low"
  condition: battery_percentage
  data:
    - refId: A
      queryType: ""
      relativeTimeRange:
        from: 300
        to: 0
      model:
        # InfluxDB query for battery percentage
```

**Alert Thresholds:**
- **Battery alerts**: <15% critical, <25% warning
- **Temperature alerts**: >40°C high, <5°C low
- **Connection alerts**: >30 minutes no data

**Deleting Provisioned Alerts:**
File-provisioned alerts cannot be deleted through the Grafana UI or standard API calls. To remove them, create a temporary deletion configuration file:

```yaml
apiVersion: 1

deleteRules:
  - orgId: 1
    uid: alert-rule-uid-1
  - orgId: 1
    uid: alert-rule-uid-2
```

Deploy this file, wait for Grafana to process the deletions, then remove the temporary file. This is the proper method for cleaning up orphaned alerts in Grafana v9.5+.

### Dashboard Families

**Service Monitoring Pattern:**
1. **Overview Dashboard**: Service status, key metrics, recent activity
2. **Detail Dashboard**: Deep-dive metrics, troubleshooting data
3. **Navigation Dashboard**: Service discovery and quick access (optional)

**Example - Sunseeker Monitoring:**
- `sunseeker-overview.json` - Battery level, current mode, connection status
- `sunseeker-battery.json` - Detailed battery health, voltage trends, temperature
- `sunseeker-navigation.json` - Quick navigation between views

**Water System Monitoring:**
- `heatpump.json` - Heat pump energy consumption and performance metrics
- **System Reference**: See `docs/water_system_spec.md` for complete MQTT topic mappings and monitoring points

### Variable Configuration

**Standard Variables:**
```json
{
  "name": "device_id",
  "type": "query",
  "query": "from(bucket: \"home_automation\") |> range(start: -24h) |> filter(fn: (r) => r[\"_measurement\"] == \"sunseeker_mode\") |> keyValues(keyColumns: [\"device_id\"]) |> group()",
  "refresh": "on_dashboard_load"
}
```

**Variable Types:**
- **Query variables**: Dynamic device/service selection
- **Constant variables**: Fixed values, configuration
- **Interval variables**: Time window selection
- **Custom variables**: Manual value lists

## Provisioning Configuration

### Dashboard Provisioning

**Dashboard Provider Configuration:**
```yaml
providers:
  - name: 'default'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /etc/grafana/provisioning/dashboards
```

**Dashboard Properties:**
- Set appropriate folder organization
- Use consistent tagging for dashboard categories
- Enable JSON model export for version control

### Data Source Configuration

**InfluxDB Data Source:**
```yaml
datasources:
  - name: InfluxDB
    type: influxdb
    url: http://influxdb:8086
    database: home_automation
    user: $INFLUXDB_READ_USER
    secureJsonData:
      password: $INFLUXDB_READ_USER_PASSWORD
```

**Security:**
- Use environment variables for credentials
- Implement read-only access for dashboard queries
- Configure appropriate retention policies

### Alert Configuration

**Contact Points:**
```yaml
contactPoints:
  - name: telegram
    type: telegram
    settings:
      botToken: $TELEGRAM_BOT_TOKEN
      chatId: $TELEGRAM_CHAT_ID
```

**Notification Policies:**
- Configure alert routing based on severity and service
- Implement escalation for critical alerts
- Use mute timings for maintenance windows

## Development Workflow

### Dashboard Development

1. **Design Phase**: Define metrics, layout, user workflows
2. **Implementation**: Create dashboard using Grafana UI
3. **Export**: Export JSON model for version control
4. **Testing**: Verify with real data, test variables and filters
5. **Documentation**: Update dashboard descriptions and variable help

### Version Control

**JSON Management:**
- Export dashboards with consistent formatting
- Remove dynamic IDs and timestamps before commit
- Use meaningful commit messages for dashboard changes
- Include screenshots in pull requests for visual changes

**Configuration Changes:**
- Test provisioning changes in development environment
- Validate YAML syntax before deployment
- Document configuration changes in commit messages

### Testing and Validation

**Dashboard Testing:**
- Verify all panels load data correctly
- Test variable interactions and filtering
- Confirm time range handling and refresh behavior
- Validate alert conditions with test data

**Performance Considerations:**
- Monitor query execution times
- Optimize complex queries with appropriate filtering
- Use dashboard query inspector for troubleshooting
- Implement query result caching where appropriate

## Troubleshooting

### Common Issues

**Dashboard Loading Problems:**
- Check InfluxDB connectivity and credentials
- Verify query syntax and data availability
- Review Grafana logs for provisioning errors
- Validate JSON syntax in dashboard files

**Alert Configuration:**
- Test alert queries independently
- Verify contact point configurations
- Check notification policy routing
- Review alert rule evaluation frequency

### Monitoring Grafana Health

**Key Metrics:**
- Dashboard load times
- Query execution performance
- Alert evaluation success rate
- Data source connectivity status

**Log Locations:**
- Grafana server logs: `/var/log/grafana/grafana.log`
- Provisioning logs: Check Grafana systemd service output
- Alert manager logs: Available through Grafana UI