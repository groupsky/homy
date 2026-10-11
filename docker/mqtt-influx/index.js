#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const {InfluxDB} = require('@influxdata/influxdb-client')

const {parseInstances} = require('./instances')

const mqttUrl = process.env.BROKER
// One or more bridges, each with its own topics, converter and tags. TOPIC may
// hold more than one comma-separated pattern because a producer can split a
// device's data across topics: zigbee2mqtt publishes availability separately
// from state, and availability is the half that shows a device dropping off
// the mesh.
//
// A bridge with a converter hands every message to that one converter, which
// receives (payload, topic). Producers that do not stamp a `_type` into the
// payload (anything not written by this project, zigbee2mqtt included) cannot
// be dispatched by payload inspection, so the bridge is told which converter
// to use instead. Without one, dispatch is on data._type.
const instances = parseInstances(process.env)
const influxUrl = process.env.INFLUXDB_URL
const influxToken = process.env.INFLUXDB_TOKEN || `${process.env.INFLUXDB_USERNAME}:${process.env.INFLUXDB_PASSWORD}`
const influxOrg = process.env.INFLUXDB_ORG || ''
const influxBucket = process.env.INFLUXDB_BUCKET || `${process.env.INFLUXDB_DATABASE}/${process.env.INFLUXDB_RP || 'autogen'}`

const influx = new InfluxDB({url: influxUrl, token: influxToken})
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
// an unknown converter would otherwise do.
for (const {clientId, converter} of instances) {
    if (converter && !resolveConverter(converter)) {
        throw new Error(`Unknown CONVERTER ${converter} for ${clientId}`)
    }
}

/**
 * Runs one bridge: subscribes to its topics and writes converted points with
 * its tags. Any MQTT connection problem exits the whole process, so Docker
 * restarts every bridge together and none is left silently disconnected.
 */
function startBridge({clientId, topics, converter, tags}) {
    const log = `[${clientId}]`
    const forcedConverterFn = converter ? resolveConverter(converter) : null
    const writeApi = influx.getWriteApi(influxOrg, influxBucket, 'ms', {
        defaultTags: tags
    })
    const client = mqtt.connect(mqttUrl, {clientId})

    client.on('connect', function () {
        console.log(log, 'connected to', mqttUrl)
        client.subscribe(topics, function (err) {
            if (err) {
                console.log(log, 'Failure subscribing to topic', err)
                process.exit(1)
            }
            console.log(log, 'subscribed to', topics)
        })
    })
    client.on('reconnect', function () {
        console.log(log, 'reconnected to', mqttUrl)
    })
    client.on('close', function () {
        console.log(log, 'closed', mqttUrl)
        process.exit(1)
    })
    client.on('disconnect', function () {
        console.log(log, 'disconnect', mqttUrl)
        process.exit(1)
    })
    client.on('error', function (err) {
        console.log(log, 'error from mqtt', err)
        process.exit(1)
    })
    client.on('offline', function () {
        console.log(log, 'offline', mqttUrl)
        process.exit(1)
    })

    client.on('message', function (topic, message) {
        try {
            const data = JSON.parse(message)

            const converterFn = forcedConverterFn || resolveConverter(data._type)
            if (!converterFn) {
                console.warn(log, 'Unhandled type', data._type, data)
                return
            }

            const points = converterFn(data, topic)

            writeApi.writePoints(points)
        } catch (err) {
            // Log and skip a malformed message rather than crashing the bridge
            console.error(log, 'Failed to process message on', topic, err)
        }
    })
}

instances.forEach(startBridge)
