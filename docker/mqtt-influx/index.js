#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const {InfluxDB, Point, HttpError} = require('@influxdata/influxdb-client')

const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC
const influxUrl = process.env.INFLUX_URL
const influxToken = process.env.INFLUX_TOKEN || `${process.env.INFLUX_USERNAME}:${process.env.INFLUX_PASSWORD}`
const influxOrg = process.env.INFLUX_ORG || ''
const influxBucket = process.env.INFLUX_BUCKET || `${process.env.INFLUX_DATABASE}/${process.env.INFLUX_RP || 'autogen'}`
const tags = process.env.TAGS ? JSON.parse(process.env.TAGS) : []

const client = mqtt.connect(mqttUrl, {
    clientId: process.env.MQTT_CLIENT_ID
})
const writeApi = new InfluxDB({url: influxUrl, token: influxToken})
    .getWriteApi(influxOrg, influxBucket, 'ms', {
        defaultTags: tags
    })
const converters = {
    dds024mr: require('./converters/dds024mr')
}

client.on('connect', function () {
    console.log('connected to', mqttUrl)
    client.subscribe(topic, function (err) {
        if (err) {
            console.log('Failure subscribing to topic', err)
            process.exit(1)
        }
        console.log('subscribed to', topic)
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
    const data = JSON.parse(message)

    if (!(data._type in converters)) {
        console.warn('Unhandled type', data._type, data)
        return
    }

    const points = converters[data._type](data)

    writeApi.writePoints(points)
})
