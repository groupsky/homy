// Automation decision event processor
// Pure function for processing automation decision events into InfluxDB points

const {Point} = require('@influxdata/influxdb-client')

/**
 * Process automation decision event into InfluxDB points
 * @param {Object} data - Event data from MQTT message
 * @returns {Array<Point>} Array of InfluxDB points (empty if invalid)
 */
function processAutomationDecisionEvent(data) {
    // Validate required fields for automation decision events
    if (!data._bot || !data._bot.name || !data.reason || !data.controlMode || !data._tz) {
        console.warn('Invalid automation decision event - missing required fields:', data)
        return []
    }

    // Extract service name from _bot.name
    const serviceName = data._bot.name

    // Create InfluxDB point for automation decision
    const point = new Point('automation_status')
        .tag('service', serviceName)
        .tag('type', 'status')
        .tag('reason', data.reason)
        .tag('controlMode', data.controlMode)
        .timestamp(new Date(data._tz))

    // Add optional fields if present
    if (data.manualOverrideExpires !== undefined) {
        if (data.manualOverrideExpires === null) {
            point.stringField('manualOverrideExpires', 'null')
        } else {
            point.intField('manualOverrideExpires', data.manualOverrideExpires)
        }
    }

    if (typeof data.heaterState === 'boolean') {
        point.booleanField('heaterState', data.heaterState)
    }

    if (typeof data.solarCirculation === 'boolean') {
        point.booleanField('solarCirculation', data.solarCirculation)
    }

    // Add temperature readings as seen by controller (correlation data)
    if (data.temperatures && typeof data.temperatures === 'object') {
        if (typeof data.temperatures.top === 'number') {
            point.floatField('temp_top_seen', data.temperatures.top)
        }
        if (typeof data.temperatures.bottom === 'number') {
            point.floatField('temp_bottom_seen', data.temperatures.bottom)
        }
        if (typeof data.temperatures.solar === 'number') {
            point.floatField('temp_solar_seen', data.temperatures.solar)
        }
        if (typeof data.temperatures.ambient === 'number') {
            point.floatField('temp_ambient_seen', data.temperatures.ambient)
        }
    }

    return [point]
}

module.exports = {
    processAutomationDecisionEvent
}