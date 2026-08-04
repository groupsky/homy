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
SELECT last("battery_percentage") FROM "sunseeker_power" WHERE time >= now() - 4h
SELECT last("voltage") FROM "sunseeker_battery_detail" WHERE time >= now() - 4h
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
- **`last()` over a long window is not "the current value"**: it returns the newest point in the window and keeps returning it until a newer one arrives, so `for:` cannot be relied on to filter transients -- see "`last()` Over a Long Window Defeats `for:`" under Troubleshooting
- **Data frequency varies**: Temperature data ~15min intervals, battery data ~1-4h intervals (device-dependent)
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
  noDataState: OK
  execErrState: OK
```
**Why `OK`/`OK` here**: `sunseeker_battery_detail` can legitimately stop ingesting (mower asleep,
or the InfluxDB int/float shard-poisoning bug that dropped it for days — PR #1430). A threshold
rule may only speak about data it can actually see, so both the absence path (`NoData`) and the
query-failure path (`Error`) are silenced on all four `sunseeker-battery-*` threshold rules — the
`Error` path (InfluxDB down, auth failure, "database is locked") would otherwise page the identical
four false battery/temperature emergencies with `[no value]` in the description. Absence detection
is delegated to a single dedicated rule; see "Staleness / Absence Alerts" below.

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

*Staleness / Absence Alerts:*
- Use when a threshold rule's own `noDataState`/`execErrState` must be `OK` (its measurement can
  legitimately stop ingesting) but something still needs to page on prolonged absence — **one
  dedicated rule per data source**, not duplicated across every threshold rule reading it
- **Single count query, `noDataState: Alerting`.** Do NOT build absence detection as a two-query AND
  ("field is stale AND source is alive"). ❌ **Tested and rejected**: InfluxQL `count()` over an
  entirely empty time range returns **no rows**, not `0` — even `GROUP BY time() fill(0)` does not
  synthesize a row when the whole range is empty. An AND across two such queries collapses to
  `NoData` exactly when it should fire, so it silently never alerts. Use one `count()` query against
  the field you want freshness on, with `noDataState: Alerting`
- **The counted field defines "stale"**: counting a field that is simply absent from an otherwise-
  populated window is indistinguishable from no data at all. Pick the field with the best coverage
  on the measurement — e.g. `percentage` on `sunseeker_battery_detail` (~99% of points; see
  `docs/influxdb-schema.md`)
- **Threshold headroom, not `lt 1`**: a partial outage produces a trickle, not a clean absence. `lt
  1` lets a single straggler point flip the rule back to `OK` and emit a false all-clear, which then
  re-fires on the next gap — several page/resolve cycles per day through a degraded period. Set the
  count threshold with headroom below the healthy per-window floor, not at the absolute minimum.
  Worked example: `sunseeker_battery_detail` normally logs 5-6 points/30m; the July 2026 incident was
  a trickle (4-11 points/day instead of ~288) that a `lt 1` threshold would have flapped on
  repeatedly, while `lt 2` requires a ~12x cadence collapse before it fires
- **`for:` is a genuine transient filter here** — unlike `last()` over a long window (see
  Troubleshooting, "`last()` Over a Long Window Defeats `for:`"). A sliding `count()` window has no
  single point to latch onto: every evaluation during the pending window is an independent
  observation of absence, so a corrective sample immediately un-trips it. Contrast: `last()` keeps
  returning the same stale point on every evaluation until a newer one arrives, so a transient can
  ride out the whole `for:` window as if it were still true
- Example: `sunseeker-telemetry-stale`
  (`config/grafana/provisioning/alerting/sunseeker-telemetry-alerts.yaml`) —
  `SELECT count("percentage") FROM "sunseeker_battery_detail" WHERE time >= now() - 30m`, `lt 2`,
  `noDataState: Alerting`, `execErrState: Alerting`, `for: 1h`. Time to page ≈ 90-95 min after the
  last point (30m for the window to empty + 1h pending) — deliberately after
  `sunseeker-connection-lost` (~30-35 min), so a genuinely unreachable mower is named as a connection
  loss first. This is an accepted trade-off, not a bug: a real outage produces two alerts, and
  collapsing them to one needs the two-query AND that provably does not work (above)

**Alert Thresholds:**
- **Battery alerts**: <15% critical, <25% warning
- **Temperature alerts**: >40°C high, <5°C low
- **Connection alerts**: >30 minutes no data
- **Telemetry staleness**: `sunseeker-telemetry-stale` pages ~90-95 min after the last
  `sunseeker_battery_detail` point — see "Staleness / Absence Alerts" above
- **`noDataState`/`execErrState` on threshold rules reading a measurement that can stop ingesting**:
  set BOTH to `OK`, and delegate absence detection to exactly one dedicated staleness rule per data
  source (PR #1430 postmortem). Otherwise every threshold rule on that measurement becomes a
  duplicate, mis-named alarm for the same pipeline fault. The staleness rule is the sole owner of "I
  cannot see this data" and takes `Alerting` on both paths

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

**Step-by-Step Deletion Process:**
1. **Identify alert UIDs**: Find the `uid` values from the alert YAML files you want to delete
2. **Create permanent deletion file**: Create a `delete-[name]-alerts.yaml` file in `config/grafana/provisioning/alerting/`
3. **Commit to git**: Keep the deletion file in version control as permanent record
4. **Deploy**: Grafana will process the deletions automatically (usually within 30 seconds)
5. **Verify deletion**: Check Grafana UI to confirm alerts are removed

**Example workflow:**
```bash
# 1. Create permanent deletion file
echo "apiVersion: 1

deleteRules:
  - orgId: 1
    uid: problematic-alert-uid" > config/grafana/provisioning/alerting/delete-problematic-alerts.yaml

# 2. Commit the deletion file
git add config/grafana/provisioning/alerting/delete-problematic-alerts.yaml
git commit -m "fix: remove problematic alert using proper deletion method"

# 3. Deploy and verify in Grafana UI
```

**Important Notes:**
- Keep deletion files in git history as permanent record of what was removed and when
- Use descriptive filenames (e.g., `delete-boiler-manual-mode-alert.yaml`)
- This is the proper method for cleaning up orphaned alerts in Grafana v9.5+
- Simply removing alerts from their original YAML files will NOT delete them from Grafana
- Deletion files remain active and will delete the alerts if they're ever re-created

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

## Database Configuration

Grafana's own internal state (users, dashboard metadata, alert rule state, ngalert scheduler bookkeeping) lives in its own SQLite store (`grafana.db`, under `GRAFANA_DATA_PATH`) -- this is separate from InfluxDB, which only holds time-series sensor data.

**WAL mode (`config.ini` `[database]` section):**
- `wal = true` enables SQLite Write-Ahead Logging so the ngalert scheduler's reads aren't blocked by concurrent writes (alert state, annotations, session cleanup).
- Without it, Grafana 9.5.21's default rollback-journal mode takes an exclusive lock on the whole file per write, which intermittently produced "database is locked" errors and silently missed rule evaluations (issue #1404).
- `cache_mode` and the `max_open_conn` / `max_idle_conn` / `conn_max_lifetime` pool settings are intentionally left at Grafana defaults -- see the comment in `config.ini` for why they wouldn't help here.
- **Requires a restart**: `[database]` settings, including `wal`, are read only at Grafana startup and are not hot-reloadable. Recreate/restart the `grafana` container (e.g. `docker compose up -d --build grafana`) for the change to take effect -- editing `config.ini` alone does nothing until the process restarts.

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

## System Documentation

### InfluxDB Integration
- **[Complete InfluxDB Schema](../../docs/influxdb-schema.md)** - Comprehensive documentation of all measurements, fields, tags, and data sources for effective dashboard and alert development

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

**`last()` Over a Long Window Defeats `for:`:**
- **Not the same failure as staleness/absence rules**: this trap is specific to `last()` (or `first()`/`mean()`) collapsing a long window to one point that `for:` can't tell apart from a fresh sample. A sliding `count()` doesn't have this problem — every evaluation re-counts the window from scratch, so `for:` genuinely filters transients there. See "Staleness / Absence Alerts" under Alert Patterns for the contrast.
- **Symptoms**: A rule with `for: 10m` pages on a single spurious sample anyway; once firing it stays firing long after the bad sample, and only recovers when the next good sample is published (or when the spike ages out of the query window)
- **Mechanism**: `SELECT last("value") ... WHERE time >= now() - 6h` means "the newest point in the last 6 hours", **not** "the value right now". With nothing newer published, every evaluation returns the same point. `for:` requires the condition to be *continuously true* for the given duration -- it does **not** require *fresh* data. So a spike that happens to be the last published value stays true across every evaluation in the pending window, `for:` elapses, and the rule fires. `for:` only suppresses an artefact that a corrective sample **overwrites inside the for-window**; it is not a general transient filter.
- **Recognising an affected rule** -- all three hold:
  1. The query collapses to a single point with `last()` (or `first()`/`mean()` over the whole range) over a window much longer than the source's publish interval
  2. `for:` is set, and its comment or PR description describes it as filtering transients
  3. The source can go quiet -- a sleeping vehicle, a docked battery device, a store-and-forward logger
- **Worked example** (`ioniq-tpms-*-temp-excess`, group `interval: 1m`, `for: 10m`, `SELECT last("value") ... - 6h`):
  ```
  12:00  car wakes, publishes tire_rr_temp_excess = 12.3 (TPMS refresh artefact)
  12:01  eval -> last() = 12.3 > 8  -> Pending
  12:02  car sleeps, nothing more is published
  12:03..12:10  eval -> last() = 12.3 (same point, still inside the 6h window) -> still Pending
  12:11  for: 10m has elapsed with the condition continuously true -> Alerting, pages
  18:00  the 12:00 point finally ages out of the 6h window -> NoData -> noDataState: OK -> clears
  ```
  Had a corrective frame arrived at 12:02, `last()` would have returned it and the rule would have resolved from Pending without paging. That is the only case `for:` covers.
- **Practical test**: `for:` is a real transient filter only when the source reliably publishes **several** samples inside the for-window. If `for` is smaller than ~2x the publish interval, or the source can stop publishing entirely, treat `for:` as best-effort and say so in a comment on the rule.
- **Solutions**, in order of preference:
  1. **Shorten the query window** so `last()` cannot hold a stale point. Only safe when the source publishes reliably -- and check `noDataState` first: `NoData` will page on every quiet period, `OK` will *silently clear* a real alert instead of holding last known state.
  2. **Aggregate in InfluxQL, not in the reducer.** For a `gt` threshold use `min()`, for an `lt` threshold use `max()`, so a lone outlier cannot drive the rule:
     ```sql
     ✅ SELECT max("soh") FROM "ioniq" WHERE "group"='bms/2105' AND time >= now() - 24h
     ❌ SELECT last("soh") FROM "ioniq" WHERE "group"='bms/2105' AND time >= now() - 24h
     ```
     **Gotcha**: the `classic_conditions` `reducer` is applied to the *query result*, and `SELECT last(...)` has already collapsed that to a single point -- so changing `reducer: last` to `reducer: min`/`avg` does nothing. The aggregation has to happen in the query. The cost is detection latency: with `max()` over 24h a genuine step down is only reported once it dominates the whole window, so use this only for slow-moving signals.
  3. **Add an explicit freshness gate**: a second query `SELECT count("value") ... time >= now() - 20m` with a `gt 0` condition ANDed in, so the rule can only fire on recent data. This costs persistence -- the alert clears as soon as the source sleeps, which is often exactly what the long window was there to prevent.
  4. **Fix upstream and document it**: where the long window is deliberate (keeping an alert visible after a device sleeps), the transient filter belongs in the producer, not the alert rule. Keep `for:` as a cheap backstop, but comment on the rule that it is not a guarantee.
- **Still worth setting `for:`**: it reliably absorbs a one-off evaluation glitch and it genuinely filters transients on fast, always-on sources (e.g. `sunseeker-battery-*`, which publish every 2-5 min while awake). The failure is specific to the combination of a long `last()` window and a source that can go silent.
- **Reference**: issues #1417 (analysis) and #1419 (per-rule audit of the provisioned rules)

**"database is locked" Errors (ngalert scheduler):**
- **Symptoms**: Grafana logs show `database is locked` errors, alert rule evaluations silently missed
- **Cause**: SQLite (`grafana.db`) in default rollback-journal mode takes an exclusive whole-file lock per write, blocking the ngalert scheduler's concurrent reads
- **Fix**: Enable WAL mode via `[database] wal = true` in `config.ini` (see "Database Configuration" above), then restart/recreate the `grafana` container -- the setting is not hot-reloadable
- **If it recurs after WAL is enabled**: Confirm `GRAFANA_DATA_PATH` is a local filesystem, not a network mount (NFS/SMB) -- WAL relies on shared-memory locking that networked filesystems don't support correctly

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