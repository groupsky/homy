const { buildRecord } = require('./record')
const { payloadPreview } = require('./payload-preview')
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
 *
 * A payload that is not valid JSON is archived raw, not dropped: this is the
 * only record of the topics it covers. `buildRecord` is written not to throw,
 * but nothing enforces that, so it is called inside a `try` — which matters
 * because this listener is `async`: an escaping exception would be a rejected
 * promise, and NODE_OPTIONS="--unhandled-rejections=strict" in the Dockerfile
 * makes that fatal (issue #1526). See the backstop below. Either failure is
 * logged with a bounded payload preview so a broken publisher cannot flood the
 * log.
 */
function startArchiving({ client, collection, env = process.env }) {
    client.on('message', async function (topic, message) {
        let built
        try {
            built = buildRecord(topic, message)
        } catch (err) {
            // buildRecord is written not to throw, but nothing enforces that
            // invariant. This backstop makes the guarantee structural: an
            // exception here would be a rejected promise, which
            // NODE_OPTIONS="--unhandled-rejections=strict" turns into exit 1.
            // Losing one message is strictly better than losing the archiver.
            console.error('Failed to build record for topic', topic,
                `"${payloadPreview(message)}"`, err)
            return
        }
        if (built.error) {
            console.error('Failed to parse payload for topic', topic,
                `"${payloadPreview(message)}"`, built.error, '- archiving raw')
        }
        try {
            await collection.insertOne(built.record)
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
