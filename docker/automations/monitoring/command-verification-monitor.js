/**
 * Command Verification Monitoring Dashboard
 * Monitors bath-lights command verification performance and reliability
 * 
 * Usage:
 * 1. Run this script alongside the main automation system
 * 2. It subscribes to failure events and success patterns
 * 3. Provides real-time statistics and alerts
 * 4. Exports metrics for integration with monitoring systems
 */

const mqtt = require('mqtt')

class CommandVerificationMonitor {
    constructor(mqttUrl, options = {}) {
        this.client = mqtt.connect(mqttUrl)
        this.options = {
            alertThreshold: options.alertThreshold || 0.1, // 10% failure rate triggers alert
            reportInterval: options.reportInterval || 60000, // 1 minute reporting
            retentionHours: options.retentionHours || 24,   // 24 hours of data retention
            ...options
        }
        
        // Statistics tracking
        this.stats = {
            total: {
                commands: 0,
                successes: 0,
                failures: 0,
                retries: 0,
                verificationTimeouts: 0
            },
            byController: new Map(), // controller -> stats
            byReason: new Map(),     // reason -> stats
            recentFailures: [],      // Array of recent failure events
            hourlyStats: []          // Hourly aggregated statistics
        }
        
        this.setupSubscriptions()
        this.startReporting()
    }
    
    setupSubscriptions() {
        // Subscribe to all automation failure events
        this.client.subscribe('homy/automation/+/command_failed', (err) => {
            if (err) {
                console.error('Failed to subscribe to failure events:', err)
            } else {
                console.log('Monitoring command verification failures...')
            }
        })
        
        // Subscribe to verification success patterns (if verbose logging enabled)
        this.client.subscribe('homy/automation/+/debug', (err) => {
            if (err) {
                console.warn('Could not subscribe to debug events:', err)
            }
        })
        
        this.client.on('message', (topic, message) => {
            try {
                const payload = JSON.parse(message.toString())
                this.handleMessage(topic, payload)
            } catch (error) {
                console.warn('Failed to parse message:', topic, message.toString())
            }
        })
        
        this.client.on('connect', () => {
            console.log('Command verification monitor connected to MQTT')
        })
        
        this.client.on('error', (error) => {
            console.error('MQTT connection error:', error)
        })
    }
    
    handleMessage(topic, payload) {
        const topicParts = topic.split('/')
        
        if (topic.includes('/command_failed')) {
            // Extract controller name from topic: homy/automation/{controller}/command_failed
            const controller = topicParts[2]
            this.recordFailure(controller, payload)
        } else if (topic.includes('/debug')) {
            // Handle debug messages for success tracking
            const controller = topicParts[2]
            this.recordDebugEvent(controller, payload)
        }
    }
    
    recordFailure(controller, failure) {
        const {reason, attempts, expectedState, actualState, timestamp} = failure
        
        // Update global stats
        this.stats.total.commands++
        this.stats.total.failures++
        this.stats.total.retries += (attempts - 1) // Subtract 1 for initial attempt
        
        // Update per-controller stats
        if (!this.stats.byController.has(controller)) {
            this.stats.byController.set(controller, {
                commands: 0, successes: 0, failures: 0, retries: 0
            })
        }
        const controllerStats = this.stats.byController.get(controller)
        controllerStats.commands++
        controllerStats.failures++
        controllerStats.retries += (attempts - 1)
        
        // Update per-reason stats
        if (!this.stats.byReason.has(reason)) {
            this.stats.byReason.set(reason, {
                commands: 0, successes: 0, failures: 0, retries: 0
            })
        }
        const reasonStats = this.stats.byReason.get(reason)
        reasonStats.commands++
        reasonStats.failures++
        reasonStats.retries += (attempts - 1)
        
        // Store recent failure for analysis
        this.stats.recentFailures.push({
            timestamp: Date.now(),
            controller,
            reason,
            attempts,
            expectedState,
            actualState,
            originalTimestamp: timestamp
        })
        
        // Trim old failures
        const cutoff = Date.now() - (this.options.retentionHours * 60 * 60 * 1000)
        this.stats.recentFailures = this.stats.recentFailures.filter(f => f.timestamp > cutoff)
        
        // Check for alert conditions
        this.checkAlerts(controller)
        
        console.log(`[FAILURE] ${controller} - ${reason}: expected ${expectedState}, got ${actualState} after ${attempts} attempts`)
    }
    
    recordDebugEvent(controller, debug) {
        // This would parse debug logs for success events if verbose logging is enabled
        // For now, we estimate successes based on the absence of failures
    }
    
    checkAlerts(controller) {
        const controllerStats = this.stats.byController.get(controller)
        if (!controllerStats || controllerStats.commands < 10) return // Need minimum sample size
        
        const failureRate = controllerStats.failures / controllerStats.commands
        if (failureRate > this.options.alertThreshold) {
            this.sendAlert(controller, failureRate, controllerStats)
        }
    }
    
    sendAlert(controller, failureRate, stats) {
        const alert = {
            type: 'high_failure_rate',
            controller,
            failureRate: Math.round(failureRate * 100),
            stats,
            timestamp: Date.now()
        }
        
        console.error(`[ALERT] High failure rate for ${controller}: ${alert.failureRate}% (${stats.failures}/${stats.commands})`)
        
        // Publish alert for external monitoring systems
        this.client.publish('homy/automation/alerts/high_failure_rate', JSON.stringify(alert))
    }
    
    generateReport() {
        const now = Date.now()
        const report = {
            timestamp: now,
            summary: {
                ...this.stats.total,
                failureRate: this.stats.total.commands > 0 ? 
                    Math.round((this.stats.total.failures / this.stats.total.commands) * 100) : 0,
                avgRetriesPerFailure: this.stats.total.failures > 0 ?
                    Math.round((this.stats.total.retries / this.stats.total.failures) * 10) / 10 : 0
            },
            controllers: {},
            reasons: {},
            recentFailures: this.stats.recentFailures.slice(-10) // Last 10 failures
        }
        
        // Per-controller breakdown
        for (const [controller, stats] of this.stats.byController.entries()) {
            report.controllers[controller] = {
                ...stats,
                failureRate: stats.commands > 0 ? 
                    Math.round((stats.failures / stats.commands) * 100) : 0,
                avgRetriesPerFailure: stats.failures > 0 ?
                    Math.round((stats.retries / stats.failures) * 10) / 10 : 0
            }
        }
        
        // Per-reason breakdown
        for (const [reason, stats] of this.stats.byReason.entries()) {
            report.reasons[reason] = {
                ...stats,
                failureRate: stats.commands > 0 ? 
                    Math.round((stats.failures / stats.commands) * 100) : 0
            }
        }
        
        return report
    }
    
    startReporting() {
        setInterval(() => {
            const report = this.generateReport()
            
            // Console output
            console.log('\n=== Command Verification Report ===')
            console.log(`Total Commands: ${report.summary.commands}`)
            console.log(`Success Rate: ${100 - report.summary.failureRate}%`)
            console.log(`Failure Rate: ${report.summary.failureRate}%`)
            console.log(`Avg Retries per Failure: ${report.summary.avgRetriesPerFailure}`)
            
            if (Object.keys(report.controllers).length > 0) {
                console.log('\nPer-Controller Stats:')
                for (const [controller, stats] of Object.entries(report.controllers)) {
                    console.log(`  ${controller}: ${stats.commands} commands, ${100 - stats.failureRate}% success`)
                }
            }
            
            if (report.recentFailures.length > 0) {
                console.log(`\nRecent Failures: ${report.recentFailures.length}`)
                report.recentFailures.slice(-3).forEach(failure => {
                    console.log(`  ${failure.controller}/${failure.reason}: ${failure.attempts} attempts`)
                })
            }
            
            // Publish report for external monitoring
            this.client.publish('homy/automation/monitoring/verification_report', JSON.stringify(report))
            
        }, this.options.reportInterval)
    }
    
    // Export metrics in Prometheus format
    exportPrometheus() {
        const metrics = []
        
        // Global metrics
        metrics.push(`# HELP bath_lights_commands_total Total number of commands sent`)
        metrics.push(`# TYPE bath_lights_commands_total counter`)
        metrics.push(`bath_lights_commands_total ${this.stats.total.commands}`)
        
        metrics.push(`# HELP bath_lights_failures_total Total number of command failures`)
        metrics.push(`# TYPE bath_lights_failures_total counter`)
        metrics.push(`bath_lights_failures_total ${this.stats.total.failures}`)
        
        metrics.push(`# HELP bath_lights_retries_total Total number of command retries`)
        metrics.push(`# TYPE bath_lights_retries_total counter`)
        metrics.push(`bath_lights_retries_total ${this.stats.total.retries}`)
        
        // Per-controller metrics
        for (const [controller, stats] of this.stats.byController.entries()) {
            metrics.push(`bath_lights_commands_total{controller="${controller}"} ${stats.commands}`)
            metrics.push(`bath_lights_failures_total{controller="${controller}"} ${stats.failures}`)
            metrics.push(`bath_lights_retries_total{controller="${controller}"} ${stats.retries}`)
        }
        
        return metrics.join('\n')
    }
}

// Usage example
if (require.main === module) {
    const brokerUrl = process.env.BROKER || 'mqtt://localhost:1883'
    const monitor = new CommandVerificationMonitor(brokerUrl, {
        alertThreshold: 0.1,      // Alert if >10% failure rate
        reportInterval: 60000,    // Report every minute
        retentionHours: 24        // Keep 24 hours of data
    })
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down command verification monitor...')
        monitor.client.end()
        process.exit(0)
    })
    
    console.log('Command verification monitor started. Press Ctrl+C to stop.')
}

module.exports = CommandVerificationMonitor