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

// Physical bounds on the traction pack, used to recognise a mis-decoded frame.
// The pack is 96 cells in series, so it cannot exceed ~403 V; the motor draws at
// most ~280 A and regen/rapid-charge returns at most ~210 A. Both limits sit far
// outside the widest values in 7.5 weeks of production data (0 to 396.1 V,
// -207.9 A to 278.7 A) so a healthy frame can never reach them. hv_v reads a
// legitimate 0 on some parked frames (contactors open), hence no lower bound.
const MAX_PLAUSIBLE_PACK_V = 500
const MAX_PLAUSIBLE_PACK_A = 600

/**
 * The OBD logger occasionally gets a "no data" response from the ECU for the
 * primary BMS query (raw frame `6101FFFFFFFF...`) and decodes it as literal
 * 0 instead of omitting the fields. A real pack can never read exactly 0 V
 * on both min and max cell simultaneously (that's every cell physically
 * destroyed/disconnected at once), so this is an unambiguous garbage-frame
 * signature — not a real vehicle state. Dropping the whole point here stops
 * it from tripping Grafana's raw-field thresholds (cell under-voltage, etc).
 *
 * A mis-decode does not always zero the cell voltages. On 2026-08-27 one frame
 * arrived with plausible cell voltages but hv_v 5838 V, hv_a 1280 A and
 * temp_max 59 degC while parked - the only sample above 55 degC in the entire
 * history, and enough to trip the pack-temperature critical rule. Bounding the
 * pack voltage and current catches that shape too, and keeps a 7472 kW spike
 * out of every max() on a dashboard.
 */
function isGarbageBmsFrame(data) {
    if (data.group !== 'bms/2101') {
        return false
    }
    if (data.cell_min_v === 0 && data.cell_max_v === 0) {
        return true
    }
    if (Number.isFinite(data.hv_v) && Math.abs(data.hv_v) > MAX_PLAUSIBLE_PACK_V) {
        return true
    }
    return Number.isFinite(data.hv_a) && Math.abs(data.hv_a) > MAX_PLAUSIBLE_PACK_A
}

/**
 * Converts an `ioniq` parsed telemetry payload into a single InfluxDB point.
 * Tags: group, state (low-cardinality; what dashboards filter/group by).
 * Timestamp: data.ts (epoch ms) passed straight to the ms-precision write API.
 */
module.exports = function ioniq(data) {
    if (isGarbageBmsFrame(data)) {
        return []
    }

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
