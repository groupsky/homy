const {Point} = require('@influxdata/influxdb-client')

// Payload keys that map to the measurement's identity, not to fields.
// Beyond converters/ioniq.js's RESERVED set, this also excludes `kind` (the
// only tag on this measurement, per the design spec §6.2) and the framework's
// auto-added `_bot`/`_tz` envelope metadata, so neither leaks in as a spurious
// string field (a pre-existing quirk of the `ioniq` converter deliberately not
// replicated here).
const RESERVED = new Set(['_type', 'group', 'state', 'ts', 'kind', '_bot', '_tz'])

/**
 * Adds one payload leaf to the point, choosing the InfluxDB field type by the
 * JS runtime type. Mirrors the typing discipline of converters/ioniq.js:
 * numbers are stored uniformly as floats (even integral ones) so a field that
 * is sometimes an int and sometimes a float never triggers an InfluxDB
 * int/float type conflict; nested objects are flattened recursively into
 * dotted keys and arrays are JSON-stringified into one string field, though
 * the §4 session metrics are all flat scalars in practice. null/undefined
 * leaves are skipped so a null metric simply omits its field rather than
 * writing a sentinel. Unknown types fall back to a string so a future payload
 * shape can never crash the bridge.
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
 * Converts an `ioniq-session` payload (one closed trip/charge/park record
 * from the `ioniq-sessions` automations bot, published to
 * `ioniq/derived/{trip,charge,park}`) into a single InfluxDB point in the
 * `ioniq_sessions` measurement.
 *
 * Tag: `kind` (`trip` | `charge` | `park` — low-cardinality; the only tag).
 * Timestamp: `start_ts` (epoch ms) — records are back-dated to session start
 * so a "trips over time" axis places each session where it began. `end_ts`
 * is carried as a field, not the timestamp.
 * Fields: every other payload key, typed by JS runtime type (see addField).
 */
module.exports = function ioniqSession(data) {
    const point = new Point('ioniq_sessions')

    if (data.kind !== undefined && data.kind !== null) {
        point.tag('kind', String(data.kind))
    }
    if (data.start_ts !== undefined && data.start_ts !== null) {
        point.timestamp(data.start_ts)
    }

    for (const [key, value] of Object.entries(data)) {
        if (RESERVED.has(key)) {
            continue
        }
        addField(point, key, value)
    }

    return [point]
}
