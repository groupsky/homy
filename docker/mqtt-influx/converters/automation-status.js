const {Point} = require('@influxdata/influxdb-client')

/**
 * Converts automation system status messages to InfluxDB points
 * Stores only controller-specific data (source of truth) and controller view for correlation
 *
 * @param {Object} input - MQTT message from homy/automation/+/status topic
 * @returns {Array<Point>} InfluxDB points for automation status data
 */
module.exports = function automationStatus(input) {
  // Input validation
  if (!input || typeof input !== 'object') {
    return []
  }

  // Required fields validation
  if (!input.reason || !input.controlMode || !input._tz) {
    return []
  }

  const point = new Point('automation_status')
    .tag('service', 'boiler_controller')
    .tag('type', 'status')
    .timestamp(input._tz)

  // Controller decisions (source of truth)
  point.stringField('reason', input.reason)
  point.stringField('controlMode', input.controlMode)

  // Only include manualOverrideExpires if it's not null
  if (input.manualOverrideExpires !== null && input.manualOverrideExpires !== undefined) {
    point.intField('manualOverrideExpires', input.manualOverrideExpires)
  }

  // Controller view for correlation (not authoritative)
  if (typeof input.heaterState === 'boolean') {
    point.booleanField('heaterState', input.heaterState)
  }

  if (typeof input.solarCirculation === 'boolean') {
    point.booleanField('solarCirculation', input.solarCirculation)
  }

  // Temperature readings as seen by controller when making decision
  if (input.temperatures && typeof input.temperatures === 'object') {
    const temps = input.temperatures

    if (typeof temps.top === 'number') {
      point.floatField('temp_top_seen', temps.top)
    }

    if (typeof temps.bottom === 'number') {
      point.floatField('temp_bottom_seen', temps.bottom)
    }

    if (typeof temps.solar === 'number') {
      point.floatField('temp_solar_seen', temps.solar)
    }

    if (typeof temps.ambient === 'number') {
      point.floatField('temp_ambient_seen', temps.ambient)
    }
  }

  return [point]
}