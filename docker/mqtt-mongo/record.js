const { payloadPreview } = require('./payload-preview')

// Ingest-timestamp keys stamped into every archived payload.
// TZ_FIELD (epoch-ms number) is the historical field kept for the existing
// mqtt-mongo-history consumer. TS_FIELD is the same instant as a BSON `Date`,
// the only field type a MongoDB TTL index can expire on. The TTL index must
// point at this key's path in the stored document (payload.<TS_FIELD>); ttl.js
// derives that path from TS_FIELD so the two can never drift apart.
const TS_FIELD = '_ts'
const TZ_FIELD = '_tz'

// Keys of the wrapper built for a message that cannot be archived as an object
// (see buildRecord). RAW_FIELD holds the payload as it arrived; ERROR_FIELD
// says why it was wrapped.
const RAW_FIELD = '_raw'
const ERROR_FIELD = '_parseError'

// Characters of the raw payload kept in the wrapper. Generous next to real
// payloads (an Ioniq OBD frame is tens of bytes) and far below MongoDB's 16 MB
// document limit, so a rogue publisher cannot make insertOne fail — a write
// failure is fatal in archive.js, which would reintroduce the crash this bound
// exists to prevent. Truncation is marked in-band by payloadPreview.
const RAW_LENGTH = 65536

/**
 * True for a value MongoDB can store as `payload` and a TTL index on
 * `payload.<TS_FIELD>` can reach: a non-null, non-array object.
 *
 * `null`, scalars and arrays all parse successfully but cannot carry the
 * timestamps — assigning to a scalar is a silent no-op, and properties set on
 * an array do not survive BSON serialization — so a document built from one
 * would never expire.
 */
function isArchivableObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Builds the Mongo record for one MQTT message.
 *
 * Both timestamps are only set when absent, so re-processing or a producer that
 * already stamped them is preserved. `now` is injectable for deterministic
 * tests.
 *
 * A payload that is not valid JSON, or that is valid JSON but not an object, is
 * wrapped as `{ _raw, _parseError }` rather than dropped or thrown: this archive
 * is the only record of the topics it covers, and throwing here killed the
 * process (issue #1526). The wrapper is stamped like any other payload, so
 * retention still applies to it.
 */
function buildRecord(topic, message, now = new Date()) {
    let payload
    try {
        payload = JSON.parse(message)
        if (!isArchivableObject(payload)) {
            payload = wrapRaw(message, `payload is not a JSON object (${typeof payload})`)
        }
    } catch (err) {
        payload = wrapRaw(message, err.message)
    }
    if (!payload[TZ_FIELD]) {
        payload[TZ_FIELD] = now.getTime()
    }
    if (!payload[TS_FIELD]) {
        payload[TS_FIELD] = now
    }
    return { topic, payload }
}

function wrapRaw(message, reason) {
    return {
        [RAW_FIELD]: payloadPreview(message, RAW_LENGTH),
        [ERROR_FIELD]: reason,
    }
}

module.exports = { buildRecord, TS_FIELD, RAW_FIELD, ERROR_FIELD, RAW_LENGTH }
