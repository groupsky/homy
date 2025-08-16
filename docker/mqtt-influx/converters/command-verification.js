/**
 * Converter for bath-lights command verification events
 * Converts MQTT messages to InfluxDB points for Grafana visualization
 */

const {Point} = require('@influxdata/influxdb-client')

module.exports = (data) => {
    const points = []
    
    if (data.type === 'command_failed') {
        // Single failure event
        const point = new Point('command_failure')
            .tag('controller', data.controller)
            .tag('reason', data.reason)
            .intField('attempts', data.attempts)
            .booleanField('expected_state', data.expectedState)
            .booleanField('actual_state', data.actualState)
            .timestamp(new Date(data.timestamp))
        
        points.push(point)
        
    } else if (data.type === 'verification_report') {
        // Summary metrics
        const summaryPoint = new Point('verification_summary')
            .intField('total_commands', data.summary.commands)
            .intField('total_failures', data.summary.failures)
            .intField('total_retries', data.summary.retries)
            .intField('failure_rate_percent', data.summary.failureRate)
            .floatField('avg_retries_per_failure', data.summary.avgRetriesPerFailure)
            .timestamp(new Date(data.timestamp))
        
        points.push(summaryPoint)
        
        // Per-controller metrics
        for (const [controller, stats] of Object.entries(data.controllers || {})) {
            const controllerPoint = new Point('verification_by_controller')
                .tag('controller', controller)
                .intField('commands', stats.commands)
                .intField('failures', stats.failures)
                .intField('retries', stats.retries)
                .intField('failure_rate_percent', stats.failureRate)
                .floatField('avg_retries_per_failure', stats.avgRetriesPerFailure)
                .timestamp(new Date(data.timestamp))
            
            points.push(controllerPoint)
        }
        
        // Per-reason metrics
        for (const [reason, stats] of Object.entries(data.reasons || {})) {
            const reasonPoint = new Point('verification_by_reason')
                .tag('reason', reason)
                .intField('commands', stats.commands)
                .intField('failures', stats.failures)
                .intField('retries', stats.retries)
                .intField('failure_rate_percent', stats.failureRate)
                .timestamp(new Date(data.timestamp))
            
            points.push(reasonPoint)
        }
    }
    
    return points
}