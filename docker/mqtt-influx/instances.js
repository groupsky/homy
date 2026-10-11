/* eslint-env node */

/**
 * Splits a topic list into MQTT subscription patterns. Accepts the
 * comma-separated string form of TOPIC or an array.
 */
function splitTopics(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(',')
    return list.map((t) => String(t).trim()).filter(Boolean)
}

/**
 * Returns the bridges this process runs, as
 * [{clientId, topics, converter, tags}].
 *
 * INSTANCES (a JSON array of {clientId, topic, converter?, tags?}) runs several
 * bridges in one Node process, so one container replaces several that differ
 * only in topic, converter and tags. Each bridge keeps its own MQTT client and
 * InfluxDB write API. Without INSTANCES there is one bridge built from TOPIC,
 * CONVERTER, MQTT_CLIENT_ID and TAGS, exactly as before.
 */
function parseInstances(env) {
    if (!env.INSTANCES) {
        return [{
            clientId: env.MQTT_CLIENT_ID,
            topics: splitTopics(env.TOPIC),
            converter: env.CONVERTER,
            tags: env.TAGS ? JSON.parse(env.TAGS) : {},
        }]
    }

    const list = JSON.parse(env.INSTANCES)
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error('INSTANCES must be a non-empty JSON array')
    }
    const seen = new Set()
    return list.map((item, i) => {
        const clientId = item && item.clientId
        if (typeof clientId !== 'string' || !clientId) {
            throw new Error(`INSTANCES[${i}] needs a clientId`)
        }
        // The broker drops the older connection when a second one uses the same
        // client id, so two bridges with one id would keep kicking each other off.
        if (seen.has(clientId)) {
            throw new Error(`INSTANCES[${i}] repeats clientId ${clientId}`)
        }
        seen.add(clientId)
        const topics = splitTopics(item.topic)
        if (topics.length === 0) {
            throw new Error(`INSTANCES[${i}] (${clientId}) needs a topic`)
        }
        return {clientId, topics, converter: item.converter, tags: item.tags || {}}
    })
}

module.exports = {parseInstances}
