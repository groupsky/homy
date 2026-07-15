const {Point} = require('@influxdata/influxdb-client')

// Number of relay outputs packed into the `outputs` word
const OUTPUT_COUNT = 16

/**
 * Converts an Aspar MOD-16RO relay-module reading into InfluxDB points.
 *
 * Stores the raw `outputs` word plus one boolean field per relay so individual
 * relay states can be plotted in Grafana. The module also exposes RS485 packet
 * counters: a rising `incorrect_packets` indicates serial-bus problems that can
 * corrupt readings for every device on the same bus (including the contact
 * inputs), which makes this useful for diagnosing intermittent false readings.
 */
module.exports = function asparMod16ro(input) {
    const point = new Point('dry_switch_relay')
        .tag('device.name', input.device)
        .tag('device.type', input._type)
        .tag('device.addr', input._addr)
        .timestamp(input._tz)
        .intField('outputs', input.outputs)
        .intField('switches', input.switches)
        .intField('read_ms', input._ms)
        // RS485 bus-health counters
        .intField('received_packets', input.receivedPackets)
        .intField('incorrect_packets', input.incorrectPackets)
        .intField('sent_packets', input.sentPackets)

    for (let bit = 0; bit < OUTPUT_COUNT; bit++) {
        point.booleanField(`out${bit}`, Boolean(input.outputs & (1 << bit)))
    }

    return [point]
}
