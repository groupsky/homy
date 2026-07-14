const { TS_FIELD } = require('./record')

// The Date that record.js stamps lives at payload.<TS_FIELD> in the stored
// `{ topic, payload }` document, so that is the path the TTL index must target.
// Deriving it from TS_FIELD (rather than hard-coding "_ts") prevents the class
// of bug this module fixes: an index created on top-level `_ts` matches no
// document and silently disables retention.
const TTL_FIELD_PATH = `payload.${TS_FIELD}`

/**
 * Builds the (keys, options) argument pair for `collection.createIndex` that
 * creates a TTL index expiring documents `expireSeconds` after the Date at
 * `field`. `field` may be a dotted path; the index name is derived from it
 * (dots flattened) so it is legible and stable across restarts.
 */
function ttlIndexArgs(field, expireSeconds) {
    return [
        { [field]: 1 },
        { expireAfterSeconds: expireSeconds, name: `ttl_${field.replace(/[.$]/g, '_')}` },
    ]
}

/**
 * Resolves TTL configuration from the process environment. Retention is opt-in:
 * only archives that set a positive-integer TTL_EXPIRE_SECONDS get a TTL index,
 * so generic archives (e.g. mqtt-mongo-history) keep data indefinitely.
 * Returns the createIndex argument pair, or null when TTL is not configured.
 */
function ttlIndexArgsFromEnv(env) {
    const raw = env.TTL_EXPIRE_SECONDS
    if (raw === undefined || raw === null || raw === '') {
        return null
    }
    const seconds = Number(raw)
    if (!Number.isInteger(seconds) || seconds <= 0) {
        return null
    }
    return ttlIndexArgs(TTL_FIELD_PATH, seconds)
}

module.exports = { ttlIndexArgs, ttlIndexArgsFromEnv, TTL_FIELD_PATH }
