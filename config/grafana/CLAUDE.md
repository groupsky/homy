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

**InfluxDB v2 (Flux):**
```flux
from(bucket: "home_automation")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r["_measurement"] == "sunseeker_mode")
  |> filter(fn: (r) => r["device_id"] == "${device_id}")
  |> aggregateWindow(every: v.windowPeriod, fn: last, createEmpty: false)
```

**InfluxDB v1 (InfluxQL) - Used for Alerting:**
```sql
-- Correct syntax for ALERTS - explicit time filtering required
SELECT last("battery_percentage") FROM "sunseeker_power" WHERE time >= now() - 15m
SELECT last("voltage") FROM "sunseeker_battery_detail" WHERE time >= now() - 15m
SELECT last("temperature") FROM "sunseeker_battery_detail" WHERE time >= now() - 15m

-- Incorrect syntax - will cause alert failures in Grafana 9.5+
SELECT last("battery_percentage") FROM "sunseeker_power" WHERE $timeFilter
-- Also incorrect - no time filtering means data from any time period
SELECT last("battery_percentage") FROM "sunseeker_power"
```

**Best Practices:**
- **Alert queries**: Do NOT use `$timeFilter` in Grafana 9.5+ (known issue with provisioned alerts)  
- **Alert time filtering**: `relativeTimeRange` does NOT filter InfluxQL queries - must use explicit `WHERE time >= now() - [duration]`
- **All alert queries need explicit time filtering** to prevent using stale data from disconnected devices
- **Dashboard queries**: Can use `$timeFilter` normally - works fine in dashboard context
- Use appropriate time aggregation (`aggregateWindow` for Flux, aggregate functions for InfluxQL)
- Filter by measurement and device_id early in queries
- Use dashboard variables for dynamic filtering
- Implement proper null handling with `createEmpty: false` (Flux) or appropriate WHERE clauses (InfluxQL)

### Alerting Integration

**Alert Rule Organization:**
- Group related alerts in single YAML files (e.g., `sunseeker-alerts.yaml`)
- Use descriptive alert names and labels
- Include recovery conditions for all alerts

**Working Alert Configuration Example:**
```yaml
- uid: sunseeker-battery-temp-high
  title: "Sunseeker Battery Temperature High"
  condition: A                    # References the expression refId
  data:
    - refId: temperature          # Data query
      queryType: ""
      relativeTimeRange:
        from: 900                 # 15 minutes lookback
        to: 0
      datasourceUid: P3C6603E967DC8568
      model:
        query: 'SELECT last("temperature") FROM "sunseeker_battery_detail" WHERE time >= now() - 15m'
        rawQuery: true
        resultFormat: time_series
    - refId: A                    # Condition expression
      queryType: ""
      relativeTimeRange:
        from: 0
        to: 0
      datasourceUid: __expr__
      model:
        type: classic_conditions  # ✅ Use classic_conditions
        conditions:
          - evaluator:
              params: [45]
              type: gt
            operator:
              type: and
            query:
              params: [temperature]  # References data query refId
            reducer:
              type: last
            type: query
        expression: temperature
  noDataState: NoData
  execErrState: Alerting
```

**Connectivity Alert Configuration Example:**
```yaml
- uid: sunseeker-connection-lost
  title: "Sunseeker Connection Lost"
  condition: A                     # References the expression refId
  data:
    - refId: connection            # Data query (count)
      queryType: ""
      relativeTimeRange:
        from: 1800                 # 30 minutes lookback
        to: 0
      datasourceUid: P3C6603E967DC8568
      model:
        query: 'SELECT count("connected") FROM "sunseeker_connection" WHERE "connected" = true AND time >= now() - 30m'
        rawQuery: true
        resultFormat: time_series
    - refId: A                     # Condition expression
      queryType: ""
      relativeTimeRange:
        from: 0
        to: 0
      datasourceUid: __expr__
      model:
        type: classic_conditions   # ✅ Use classic_conditions
        conditions:
          - evaluator:
              params: [1]
              type: lt             # count < 1 = disconnected
            operator:
              type: and
            query:
              params: [connection] # References data query refId
            reducer:
              type: last
            type: query
        expression: connection
  noDataState: NoData
  execErrState: Alerting
  for: 30m                         # Wait 30 minutes before alerting
```

**Alert Patterns:**

*Threshold Alerts (with conditions):*
- Use for numeric comparisons (temperature > 45°C, battery < 15%)
- Require both data query and condition expression with explicit time filtering
- Data query: `refId: "field_name"` (e.g., "temperature") with `WHERE time >= now() - [duration]`
- Condition: `refId: "A"`, references data query in `expression` and `query.params`
- **Critical**: Without time filtering, alerts use stale data and won't detect device disconnection

*Connectivity Alerts (count-based):*
- Use for heartbeat/connectivity monitoring where only positive states are recorded
- Count records of positive connectivity states in time window
- Use `SELECT count("field") WHERE "field" = true AND time >= now() - 30m` with threshold `< 1`
- Example: `SELECT count("connected") FROM "sunseeker_connection" WHERE "connected" = true AND time >= now() - 30m`
- Alert when count = 0 (no positive connectivity records in time window)
- **Important**: Include explicit time filtering with `time >= now() - [duration]` as `relativeTimeRange` alone doesn't limit InfluxQL queries

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

**Alert Query Syntax Issues:**
- **Symptoms**: Alerts showing "Error" state with "[no value]" in descriptions, "condition must not be empty", or "time series data and only reduced data can be alerted on"
- **Primary Causes**: 
  1. `$timeFilter` variable incompatibility in Grafana 9.5+ provisioned alerts
  2. Incorrect condition `type` configuration (`threshold` vs `classic_conditions`)
  3. Time series queries used directly as conditions without proper reduction
- **Solutions**: 
  1. Remove `$timeFilter` from alert queries, time filtering handled by `relativeTimeRange`:
     ```sql
     ✅ SELECT last("field_name") FROM "measurement"
     ❌ SELECT last("field_name") FROM "measurement" WHERE $timeFilter
     ```
  2. Use `classic_conditions` type for reliable alert evaluation:
     ```yaml
     model:
       type: classic_conditions  # ✅ Works reliably
       # type: threshold         # ❌ Can cause "condition must not be empty" errors
     ```
  3. For connectivity alerts, use count queries with proper conditions:
     ```sql
     ✅ SELECT count("connected") WHERE "connected" = true  # Returns single value
     ❌ SELECT last("connected")                          # May return time series
     ```
- **GitHub Issues**: Known problems documented in issues #77466 and #8195
- **Testing**: Use data source query editor to validate syntax before provisioning
- **Verification**: Check alert instances via `/api/alertmanager/grafana/api/v2/alerts` for error details

**$timeFilter Variable Limitations:**
- **Grafana 9.5+ Alerting**: `$timeFilter` gets stripped or causes evaluation failures
- **Dashboard Context**: `$timeFilter` works normally in dashboard panels
- **Provisioned vs UI**: File-provisioned alerts more affected than UI-created alerts
- **Workaround**: Use alert's `relativeTimeRange` parameter instead of `WHERE $timeFilter`

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