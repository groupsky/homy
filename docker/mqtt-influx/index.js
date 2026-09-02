#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const {InfluxDB} = require('@influxdata/influxdb-client')

const mqttUrl = process.env.BROKER
// One or more topics, comma-separated. A bridge needs more than one when the
// producer splits a device's data across topics — zigbee2mqtt publishes
// availability separately from state, and availability is the half that shows
// a device dropping off the mesh.
// Named `topics`, not `topic`: the message handler's own `topic` parameter is
// the per-message topic and must not be shadowed by the subscription list.
const topics = (process.env.TOPIC || '').split(',').map((t) => t.trim()).filter(Boolean)
// When set, every message on TOPIC is handed to this one converter, which
// receives (payload, topic). Producers that do not stamp a `_type` into the
// payload — anything not written by this project, zigbee2mqtt included —
// cannot be dispatched by payload inspection, so the service is told which
// converter to use instead. Unset restores the original behaviour exactly:
// dispatch on data._type.
const forcedConverter = process.env.CONVERTER
const influxUrl = process.env.INFLUXDB_URL
const influxToken = process.env.INFLUXDB_TOKEN || `${process.env.INFLUXDB_USERNAME}:${process.env.INFLUXDB_PASSWORD}`
const influxOrg = process.env.INFLUXDB_ORG || ''
const influxBucket = process.env.INFLUXDB_BUCKET || `${process.env.INFLUXDB_DATABASE}/${process.env.INFLUXDB_RP || 'autogen'}`
const tags = process.env.TAGS ? JSON.parse(process.env.TAGS) : []

const client = mqtt.connect(mqttUrl, {
    clientId: process.env.MQTT_CLIENT_ID
})
const writeApi = new InfluxDB({url: influxUrl, token: influxToken})
    .getWriteApi(influxOrg, influxBucket, 'ms', {
        defaultTags: tags
    })
const converters = {
    'aspar-mod-16ro': require('./converters/aspar-mod-16ro'),
    dds024mr: require('./converters/dds024mr'),
    dds519mr: require('./converters/dds519mr'),
    ex9em: require('./converters/ex9em'),
    ioniq: require('./converters/ioniq'),
    'ioniq-session': require('./converters/ioniq-session'),
    mbsl32di: require('./converters/mbsl32di'),
    'or-we-514': require('./converters/or-we-514'),
    sdm630: require('./converters/sdm630'),
    zigbee: require('./converters/zigbee'),
}

/**
 * Resolves a converter by name, or null.
 *
 * Own-property lookup, never `name in converters`: the name comes either from
 * an MQTT payload (`data._type`) or from the environment (`CONVERTER`), and
 * `in` also matches inherited keys — `{"_type":"constructor"}` would pass an
 * `in` check and then be invoked as if Object.prototype.constructor were a
 * converter.
 */
function resolveConverter(name) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(converters, name)) {
        return null
    }
    return converters[name]
}

// Fail at startup rather than silently dropping every message, which is what
// an unknown CONVERTER would otherwise do.
const forcedConverterFn = forcedConverter ? resolveConverter(forcedConverter) : null
if (forcedConverter && !forcedConverterFn) {
    throw new Error(`Unknown CONVERTER ${forcedConverter}`)
}

client.on('connect', function () {
    console.log('connected to', mqttUrl)
    client.subscribe(topics, function (err) {
        if (err) {
            console.log('Failure subscribing to topic', err)
            process.exit(1)
        }
        console.log('subscribed to', topics)
    })
})
client.on('reconnect', function () {
    console.log('reconnected to', mqttUrl)
})
client.on('close', function () {
    console.log('closed', mqttUrl)
    process.exit(1)
})
client.on('disconnect', function () {
    console.log('disconnect', mqttUrl)
    process.exit(1)
})
client.on('error', function (err) {
    console.log('error from mqtt', err)
    process.exit(1)
})
client.on('offline', function () {
    console.log('offline', mqttUrl)
    process.exit(1)
})

client.on('message', function (topic, message) {
    try {
        const data = JSON.parse(message)

        const converter = forcedConverterFn || resolveConverter(data._type)
        if (!converter) {
            console.warn('Unhandled type', data._type, data)
            return
        }

        const points = converter(data, topic)

        writeApi.writePoints(points)
    } catch (err) {
        // Log and skip a malformed message rather than crashing the bridge
        console.error('Failed to process message on', topic, err)
    }
})
