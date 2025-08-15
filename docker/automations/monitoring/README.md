# Command Verification Monitoring

This directory contains monitoring tools for the bath-lights command verification system.

## Quick Start

### 1. Start the Monitor

```bash
cd docker/automations/monitoring
BROKER=mqtt://your-mqtt-broker:1883 node command-verification-monitor.js
```

### 2. Monitor Bath1 Testing

When Bath1 verification is enabled, monitor these MQTT topics:

```bash
# Command failure events
mosquitto_sub -h your-broker -t "homy/automation/lightBath1Controller/command_failed"

# Monitoring reports (published every minute)
mosquitto_sub -h your-broker -t "homy/automation/monitoring/verification_report"

# High failure rate alerts
mosquitto_sub -h your-broker -t "homy/automation/alerts/high_failure_rate"
```

## Monitoring Setup for Production Rollout

### Phase 1: Bath1 Only (Week 1-2)

1. **Enable verification** on Bath1 by adding commandConfig to the main config.js:
   ```javascript
   lightBath1Controller: {
     // ... existing config ...
     commandConfig: {
       verification: 5000,
       maxRetries: 3,
       retryDelay: 1000,
     },
     verbose: true  // Enable detailed logging during testing
   }
   ```

2. **Start monitoring**:
   ```bash
   # In a separate terminal or as a service
   cd docker/automations/monitoring
   node command-verification-monitor.js
   ```

3. **Watch for issues**:
   - Monitor failure rate (should be <5%)
   - Check retry success rate (should be >90%)
   - Look for user complaints about delayed response

### Phase 2: Add Bath2 (Week 3-4)

If Bath1 is stable, add commandConfig to lightBath2Controller.

### Phase 3: Add Bath3 (Week 5-6)

If Bath1 and Bath2 are stable, add commandConfig to lightBath3Controller.

## Key Metrics to Track

### Success Criteria
- **Failure Rate**: <5% overall
- **Retry Success**: >90% of retried commands succeed
- **Response Time**: <5 seconds for normal operations
- **User Experience**: No complaints about delayed lights

### Alert Conditions
- **High Failure Rate**: >10% failures for any controller
- **Retry Storm**: >5 consecutive retries for the same reason
- **Complete Failure**: No successful commands for >10 minutes

## Monitoring Dashboard Example

The monitor outputs reports like this every minute:

```
=== Command Verification Report ===
Total Commands: 145
Success Rate: 97%
Failure Rate: 3%
Avg Retries per Failure: 1.8

Per-Controller Stats:
  lightBath1Controller: 52 commands, 98% success
  lightBath2Controller: 41 commands, 95% success
  lightBath3Controller: 52 commands, 98% success

Recent Failures: 2
  lightBath1Controller/toggle_on: 2 attempts
  lightBath2Controller/door_close: 3 attempts
```

## Integration with External Monitoring

### Prometheus Metrics

The monitor exports Prometheus-compatible metrics:

```bash
# Get metrics in Prometheus format
curl http://your-monitor-host:3000/metrics
```

### Grafana Dashboard

Create a Grafana dashboard with these queries:
- `bath_lights_commands_total` - Total commands over time
- `rate(bath_lights_failures_total[5m])` - Failure rate
- `bath_lights_retries_total / bath_lights_failures_total` - Avg retries per failure

### Home Assistant Integration

Add binary sensors for monitoring:

```yaml
# In Home Assistant configuration.yaml
mqtt:
  binary_sensor:
    - name: "Bath Lights Verification Health"
      state_topic: "homy/automation/monitoring/verification_report"
      value_template: "{{ 'ON' if value_json.summary.failureRate < 10 else 'OFF' }}"
```

## Troubleshooting

### High Failure Rate

If you see failure rates >10%:

1. **Check physical devices**: Are lights responding to manual switches?
2. **Network issues**: Is MQTT broker stable?
3. **Configuration**: Are timeout values too aggressive?
4. **Hardware**: Are relay contacts wearing out?

### Retry Storms

If you see many consecutive retries:

1. **Check device feedback**: Is the status topic working?
2. **State mismatch**: Are expected vs actual states misaligned?
3. **Timing issues**: Is verification timeout too short?

### Complete Failures

If no commands succeed:

1. **Rollback immediately**: Remove commandConfig to restore legacy mode
2. **Check logs**: Look for MQTT publish failures
3. **Restart service**: `docker compose restart automations`

## Rollback Procedure

If issues occur during testing:

1. **Immediate rollback**: Remove commandConfig from affected controllers
2. **Restart service**: `docker compose restart automations`
3. **Verify operation**: Check that lights respond normally
4. **Investigate**: Use logs and monitoring data to diagnose issues

The system will immediately revert to legacy mode (direct publish) without verification.

## Log Analysis

With verbose logging enabled, look for these patterns:

**Success Pattern:**
```
[lightBath1Controller] sending command (attempt 1): {"state":true,"r":"lck"} for reason: lock_on
[lightBath1Controller] command for lock_on verified successfully (state: true)
```

**Retry Pattern:**
```
[lightBath1Controller] command verification timeout for lock_on (expected: true, actual: false)
[lightBath1Controller] scheduling retry for lock_on in 1000ms
[lightBath1Controller] sending command (attempt 2): {"state":true,"r":"lck"} for reason: lock_on
```

**Failure Pattern:**
```
[lightBath1Controller] command for lock_on failed after 3 attempts - giving up
```

## Testing Checklist

### Before Enabling Verification
- [ ] All tests pass (`npm test`)
- [ ] MQTT broker is stable
- [ ] All bathroom devices respond to manual control
- [ ] Monitoring system is running

### During Testing Phase
- [ ] Monitor failure rate daily
- [ ] Test normal user scenarios (door, lock, toggle)
- [ ] Verify retry behavior with intentional network issues
- [ ] Check user experience (no delays noticed)

### Before Full Rollout
- [ ] Bath1 stable for 1-2 weeks
- [ ] Failure rate consistently <5%
- [ ] No user complaints
- [ ] Monitoring alerts working correctly