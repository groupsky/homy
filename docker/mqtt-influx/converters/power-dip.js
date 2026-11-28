const {Point} = require('@influxdata/influxdb-client')

/**
 * Converts a power dip event of the Modbus reader (#2007) into one point of
 * measurement `power_dip`.
 *
 * The reader publishes it on `/modbus/<bus>/power-dip/reading` at the start
 * and at the end of a dip of its input modules. `readings` holds the raw
 * readings it held back (at most 20); they are kept as a JSON string so a
 * dip can still be studied.
 */
module.exports = function powerDip(input) {
    const readings = Array.isArray(input.readings) ? input.readings : []
    return [
        new Point('power_dip')
            .tag('state', input.state)
            .timestamp(input._tz)
            .intField('duration_ms', input.durationMs)
            .intField('reading_count', readings.length)
            .stringField('readings', JSON.stringify(readings))
    ]
}
