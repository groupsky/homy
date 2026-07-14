const { buildRecord } = require('./record')
const { ttlIndexArgsFromEnv } = require('./ttl')

/**
 * Wires an MQTT client to a Mongo collection: every received message is archived
 * as `{ topic, payload }`, and — when retention is configured via
 * `TTL_EXPIRE_SECONDS` — a TTL index is ensured in the background.
 *
 * The message handler is attached synchronously, before (and independently of)
 * the index build, so no message is dropped while a first-time index builds over
 * an existing collection. Index creation is best-effort: it never blocks
 * archiving and a failure is logged rather than fatal. A write failure, by
 * contrast, stays fatal (process exit) so the container restarts and retries.
 */
function startArchiving({ client, collection, env = process.env }) {
    client.on('message', async function (topic, message) {
        const record = buildRecord(topic, message)
        try {
            await collection.insertOne(record)
        } catch (err) {
            console.error('Failure writing to mongo', err)
            process.exit(1)
        }
    })

    const ttlArgs = ttlIndexArgsFromEnv(env)
    if (ttlArgs) {
        collection.createIndex(...ttlArgs)
            .then(() => console.log('ensured TTL index', ttlArgs[1].name,
                'expireAfterSeconds', ttlArgs[1].expireAfterSeconds))
            .catch((err) => console.error('Failure ensuring TTL index (archiving continues)', err))
    }
}

module.exports = { startArchiving }
