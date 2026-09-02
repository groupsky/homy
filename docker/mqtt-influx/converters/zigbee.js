const {Point} = require('@influxdata/influxdb-client')

/**
 * A Zigbee IEEE address is an EUI-64 — a MAC address. This repository is
 * public and CLAUDE.md forbids MACs in it, and an InfluxDB tag value would
 * also carry one into every dashboard and export.
 *
 * This is not hypothetical. zigbee2mqtt defaults a device's `friendly_name`
 * to its IEEE address, so an unnamed device publishes on
 * `<base_topic>/0x................/availability` and the obvious
 * implementation — take the device name from the topic — writes a MAC as a
 * tag. On 2026-09-01 one of the nine devices on this mesh was in exactly
 * that state.
 *
 * Such messages are dropped rather than renamed: a placeholder tag would
 * silently merge every unnamed device into one series and hide the fact that
 * a device is going unrecorded. Give the device a `friendly_name` in
 * zigbee2mqtt and it starts recording on the next message, with no change
 * here.
 */
const IEEE_ADDRESS = /^0x[0-9a-f]{16}$/i

// zigbee2mqtt's own topics (`bridge/state`, `bridge/devices`, ...) are not
// devices. The subscription should not deliver them; this is a backstop.
const NOT_A_DEVICE = new Set(['bridge'])

/**
 * Payload keys that are represented some other way and must not also be
 * written verbatim: `last_seen` is an ISO-8601 string that becomes the
 * numeric `last_seen_ms`.
 */
const RESERVED = new Set(['last_seen'])

/**
 * Adds one payload leaf to the point, choosing the InfluxDB field type by the
 * JS runtime type. Numbers are stored uniformly as floats (even integral ones
 * like `linkquality`) so a field that is sometimes 102 and sometimes 102.5
 * never triggers an InfluxDB int/float type conflict. Nested objects are
 * flattened into dotted keys (`update.state`); arrays are JSON-stringified
 * into one string field. null/undefined leaves are skipped — zigbee2mqtt
 * publishes the full attribute set for a device including attributes it has
 * never read, so nulls are the common case, not an error. Unknown types fall
 * back to a string so a future payload shape can never crash the bridge.
 *
 * Mirrors converters/ioniq.js deliberately; see its comment for the int/float
 * reasoning.
 */
function addField(point, key, value) {
    if (value === null || value === undefined) {
        return
    }
    switch (typeof value) {
        case 'number':
            if (Number.isFinite(value)) {
                point.floatField(key, value)
            }
            break
        case 'boolean':
            point.booleanField(key, value)
            break
        case 'string':
            point.stringField(key, value)
            break
        case 'object':
            if (Array.isArray(value)) {
                point.stringField(key, JSON.stringify(value))
            } else {
                for (const [childKey, childValue] of Object.entries(value)) {
                    addField(point, `${key}.${childKey}`, childValue)
                }
            }
            break
        default:
            point.stringField(key, String(value))
    }
}

/**
 * Splits a zigbee2mqtt topic into the device name and the kind of message,
 * without knowing the base topic — `z2m/house1/1217-mariboli` and
 * `z2m/house1/1217-mariboli/availability` both yield `1217-mariboli`.
 * Returns null when the topic is not a device topic.
 */
function parseTopic(topic) {
    const segments = String(topic || '').split('/').filter(Boolean)
    if (segments.length < 2) {
        return null
    }
    const availability = segments[segments.length - 1] === 'availability'
    const device = availability ? segments[segments.length - 2] : segments[segments.length - 1]
    if (!device || NOT_A_DEVICE.has(device) || segments.includes('bridge')) {
        return null
    }
    return {device, availability}
}

/**
 * Converts a zigbee2mqtt message into a single InfluxDB point in the `zigbee`
 * measurement, tagged by the device's friendly name taken from the topic.
 *
 * Two topic shapes are handled, and availability is the reason this bridge
 * subscribes to two topics rather than one: zigbee2mqtt publishes it
 * separately from state, and it is the signal that shows a device dropping
 * off the mesh. A device that has gone silent publishes no state at all, so
 * without the availability topic its departure is invisible.
 *
 *   <base>/<device>                 state    -> the device's attributes
 *   <base>/<device>/availability    presence -> boolean field `available`
 *
 * The point carries no explicit timestamp, so the write API stamps it at
 * ingestion. That is deliberate: the question this data answers is "what did
 * we observe, and when did we observe it". The device's own claim about when
 * it was last heard from is kept separately in `last_seen_ms`, read from the
 * MQTT payload — never from zigbee2mqtt's `state.json`, where `last_seen` and
 * `linkquality` are frozen at whatever was last written because State.set()
 * caches a copy before controller.js attaches those two fields to the other
 * object.
 */
module.exports = function zigbee(data, topic) {
    const parsed = parseTopic(topic)
    if (!parsed) {
        return []
    }
    if (IEEE_ADDRESS.test(parsed.device)) {
        console.warn(
            'zigbee: refusing to record a device published under its IEEE address; ' +
            'give it a friendly_name in zigbee2mqtt (topic dropped)'
        )
        return []
    }

    const point = new Point('zigbee').tag('device', parsed.device)

    if (parsed.availability) {
        // {"state":"online"} — the only field on this topic.
        point.booleanField('available', data && data.state === 'online')
        return [point]
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return []
    }

    for (const [key, value] of Object.entries(data)) {
        if (RESERVED.has(key)) {
            continue
        }
        addField(point, key, value)
    }

    // `state` is a string across the mesh but means different things per
    // device class — ON/OFF on a relay, OPEN/CLOSE on a cover. It stays a
    // string field so the measurement never holds two types for one field
    // name, and the on/off case additionally gets a boolean `state_on`, which
    // is what correlating a relay against power events actually needs.
    if (data.state === 'ON' || data.state === 'OFF') {
        point.booleanField('state_on', data.state === 'ON')
    }

    // ISO-8601 (zigbee2mqtt is configured with last_seen: ISO_8601) to epoch
    // ms, so it is queryable arithmetically. Skipped when unparseable rather
    // than written as NaN.
    if (typeof data.last_seen === 'string') {
        const lastSeenMs = Date.parse(data.last_seen)
        if (Number.isFinite(lastSeenMs)) {
            point.floatField('last_seen_ms', lastSeenMs)
        }
    }

    return [point]
}
