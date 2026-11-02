const {Point} = require('@influxdata/influxdb-client')

// Only the appliance's own keys are logged. The bridge also publishes the
// device identity under `state/` (serial number, MAC, Wi-Fi name, IP
// addresses); none of those start with these prefixes, so they never reach
// InfluxDB.
const ALLOWED_KEY = /^(bsh_common|cooking_oven)_[a-z0-9_]+$/
const DEVICE = /^[a-z0-9_-]+$/i
const NUMBER = /^-?\d+(\.\d+)?$/

/**
 * Turns one plain-text state value into a typed field value. hcpy sends
 * `True`/`False` for booleans and bare digits for numbers. Numbers are always
 * floats so a field never flips between int and float in InfluxDB.
 */
function parseValue(raw) {
    if (typeof raw === 'number' || typeof raw === 'boolean') {
        return raw
    }
    const text = String(raw).trim()
    if (text === 'True') return true
    if (text === 'False') return false
    if (NUMBER.test(text)) return Number(text)
    return text
}

function addField(point, key, value) {
    if (typeof value === 'number') {
        if (Number.isFinite(value)) point.floatField(key, value)
    } else if (typeof value === 'boolean') {
        point.booleanField(key, value)
    } else {
        point.stringField(key, value)
    }
}

/**
 * Converts the Home Connect bridge (hcpy `hc2mqtt`) topics into the `oven`
 * measurement, one point per message, tag `device` from the topic:
 *
 * - `homeconnect/<device>/state/<key>`: plain-text value -> field `<key>`
 * - `homeconnect/<device>/event/<key>`: `{"event_type": "Present"}` ->
 *   string field `<key>` (`Present`, `Confirmed` or `Off`)
 * - `homeconnect/<device>/LWT`: `online`/`offline` -> string field `availability`
 *
 * The payload is the JSON-parsed message when it is JSON, else its text
 * (see index.js). Anything else is dropped.
 */
module.exports = function homeconnect(data, topic) {
    const parts = String(topic || '').split('/')
    if (parts[0] !== 'homeconnect' || !DEVICE.test(parts[1] || '')) {
        return []
    }
    const point = new Point('oven').tag('device', parts[1])

    if (parts.length === 3 && parts[2] === 'LWT') {
        point.stringField('availability', String(data))
        return [point]
    }
    if (parts.length !== 4 || !ALLOWED_KEY.test(parts[3])) {
        return []
    }
    const [, , kind, key] = parts
    if (kind === 'state') {
        if (data === null || typeof data === 'object') return []
        addField(point, key, parseValue(data))
        return [point]
    }
    if (kind === 'event') {
        if (!data || typeof data.event_type !== 'string') return []
        point.stringField(key, data.event_type)
        return [point]
    }
    return []
}
