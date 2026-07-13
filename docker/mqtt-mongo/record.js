/**
 * Builds the Mongo record for one MQTT message.
 *
 * `_tz` (epoch-ms number) is the historical ingest timestamp, kept for the
 * existing mqtt-mongo-history consumer. `_ts` is the same instant as a BSON
 * `Date`, which is the only field type a MongoDB TTL index can expire on.
 * Both are only set when absent, so re-processing or a producer that already
 * stamped them is preserved. `now` is injectable for deterministic tests.
 */
function buildRecord(topic, message, now = new Date()) {
    const payload = JSON.parse(message)
    if (!payload._tz) {
        payload._tz = now.getTime()
    }
    if (!payload._ts) {
        payload._ts = now
    }
    return { topic, payload }
}

module.exports = { buildRecord }
