# Webhook-Based Alerting Configuration

This directory contains Grafana alerting configuration files that implement webhook-based alerts using the custom `telegram-bridge` service.

## Structure

### Core Configuration
- `contact-points.yaml` - Defines the webhook endpoint for the telegram-bridge service
- `notification-policies.yaml` - Alert routing and grouping policies

### Alert Rules
- `ac-alert.yaml` - AC voltage monitoring (210-247V range)
- `main-power-alert.yaml` - High power consumption monitoring (>10kW)
- `water-pump-alert.yaml` - Water pump overload protection (>1kW)
- `laundry-alert.yaml` - Laundry completion notification
- `dishwasher-alert.yaml` - Dishwasher completion notification  
- `heat-pump-alerts.yaml` - Heat pump monitoring (low power + overload)

## Parallel Operation

These webhook-based alerts are designed to run **in parallel** with the existing production alerts without conflicts:

### Key Differences from Production
1. **Unique UIDs**: All alert rule UIDs are prefixed with `webhook-` to avoid conflicts
2. **Separate Folder**: All alerts are organized in "Webhook Alerting" folder instead of "General Alerting"
3. **Distinct Titles**: Alert titles include "(Webhook)" suffix for easy identification
4. **Additional Labels**: Each alert includes `alert_type: webhook` label for filtering

### Migration Strategy

1. **Phase 1** (Current): Run both systems in parallel
   - Production alerts continue using direct Telegram integration
   - Webhook alerts run simultaneously, sending to same Telegram channel
   - Monitor webhook alerts for reliability and message formatting

2. **Phase 2**: Gradual transition
   - Disable specific production alerts one by one
   - Keep corresponding webhook alerts active
   - Verify no alerts are missed during transition

3. **Phase 3**: Complete migration
   - Remove all production alert rules
   - Clean up webhook alert names (remove "(Webhook)" suffixes)
   - Move alerts back to "General Alerting" folder if desired

## Managing Alerts

### Viewing Alerts
Production and webhook alerts will appear in separate folders in Grafana:
- **General Alerting** - Original production alerts
- **Webhook Alerting** - New webhook-based alerts

### Filtering
Use the `alert_type` label to filter webhook alerts:
```
alert_type="webhook"
```

### Testing
To test the webhook system without affecting production:
1. Temporarily modify alert thresholds to trigger alerts
2. Verify messages appear correctly in Telegram
3. Check message formatting, emojis, and links
4. Restore original thresholds

## Benefits of Webhook System

1. **Rich Formatting**: HTML messages with emojis and clickable links
2. **Bulgarian Localization**: Proper timezone and date formatting
3. **Dashboard Integration**: Direct links to relevant Grafana panels
4. **Extensibility**: Easy to add new notification channels or modify formatting
5. **Reliability**: Custom service can implement retry logic and error handling

## Troubleshooting

- **Missing alerts**: Check if telegram-bridge service is running
- **Formatting issues**: Verify telegram-bridge message template logic
- **Duplicate notifications**: Ensure production alerts are disabled before removing webhook prefixes