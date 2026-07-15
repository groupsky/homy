const {Point} = require('@influxdata/influxdb-client')

// Number of digital inputs packed into the MBSL32DI `inputs` word
const INPUT_COUNT = 32

/**
 * Converts an MBSL32DI digital-input reading into InfluxDB points.
 *
 * The module reports all 32 inputs packed into a single `inputs` word. We store
 * the raw word (to spot whole-word glitches / which bits changed) plus one
 * boolean field per input bit so individual contacts can be plotted or alerted
 * on directly in Grafana without bitwise math. For example, the front door
 * contact on mbsl32di1 is bit 0, so `bit0` reflects the raw electrical state of
 * that input (note: the feature layer inverts this into door open/closed).
 */
module.exports = function mbsl32di(input) {
    // `inputs` arrives as a signed 32-bit JS int (data[1] << 16 | data[0]), so
    // it is negative when bit 31 is set. Store it unsigned for a readable raw
    // value; per-bit extraction is unaffected by the signedness.
    const inputs = input.inputs >>> 0

    const point = new Point('dry_switch_input')
        .tag('device.name', input.device)
        .tag('device.type', input._type)
        .tag('device.addr', input._addr)
        .timestamp(input._tz)
        .intField('inputs', inputs)
        .intField('read_ms', input._ms)

    for (let bit = 0; bit < INPUT_COUNT; bit++) {
        point.booleanField(`bit${bit}`, Boolean(inputs & (1 << bit)))
    }

    return [point]
}
