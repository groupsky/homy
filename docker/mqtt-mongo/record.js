// Ingest-timestamp keys stamped into every archived payload.
// TZ_FIELD (epoch-ms number) is the historical field kept for the existing
// mqtt-mongo-history consumer. TS_FIELD is the same instant as a BSON `Date`,
// the only field type a MongoDB TTL index can expire on. The TTL index must
// point at this key's path in the stored document (payload.<TS_FIELD>); ttl.js
// derives that path from TS_FIELD so the two can never drift apart.
const TS_FIELD = '_ts'
const TZ_FIELD = '_tz'

/**
 * Builds the Mongo record for one MQTT message.
 *
 * Both timestamps are only set when absent, so re-processing or a producer that
 * already stamped them is preserved. `now` is injectable for deterministic
 * tests.
 */
function buildRecord(topic, message, now = new Date()) {
    const payload = JSON.parse(message)
    if (!payload[TZ_FIELD]) {
        payload[TZ_FIELD] = now.getTime()
    }
    if (!payload[TS_FIELD]) {
        payload[TS_FIELD] = now
    }
    return { topic, payload }
}

module.exports = { buildRecord, TS_FIELD }
