const {Point} = require('@influxdata/influxdb-client')

// Payload keys that map to the measurement's identity, not to fields.
const RESERVED = new Set(['_type', 'group', 'state', 'ts'])

/**
 * Adds one payload leaf to the point, choosing the InfluxDB field type by the
 * JS runtime type. Numbers are stored uniformly as floats (even integral ones)
 * so a field that is sometimes 36 and sometimes 36.5 never triggers an
 * InfluxDB int/float type conflict. Nested objects are flattened recursively
 * into dotted keys (relays.main); arrays are JSON-stringified into one string
 * field. null/undefined leaves are skipped. Unknown types fall back to a
 * string so a future payload shape can never crash the bridge.
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
 * Converts an `ioniq` parsed telemetry payload into a single InfluxDB point.
 * Tags: group, state (low-cardinality; what dashboards filter/group by).
 * Timestamp: data.ts (epoch ms) passed straight to the ms-precision write API.
 */
module.exports = function ioniq(data) {
    const point = new Point('ioniq')

    if (data.group !== undefined && data.group !== null) {
        point.tag('group', String(data.group))
    }
    if (data.state !== undefined && data.state !== null) {
        point.tag('state', String(data.state))
    }
    if (data.ts !== undefined && data.ts !== null) {
        point.timestamp(data.ts)
    }

    for (const [key, value] of Object.entries(data)) {
        if (RESERVED.has(key)) {
            continue
        }
        addField(point, key, value)
    }

    return [point]
}
