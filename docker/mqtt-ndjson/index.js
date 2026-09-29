#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const { createDayFileWriter } = require('./day-file-writer')
const { startWriting } = require('./sink')

const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC

if (!mqttUrl || !topic) {
    console.error('BROKER and TOPIC must be set')
    process.exit(1)
}

// Throws, and so stops the service at startup, when RAW_DIR, STREAM or
// SERVICE_NAME is missing or not a plain name.
const writer = createDayFileWriter({
    root: process.env.RAW_DIR,
    stream: process.env.STREAM,
    service: process.env.SERVICE_NAME,
})

const client = mqtt.connect(mqttUrl, {
    clientId: process.env.MQTT_CLIENT_ID
})

// Registered once, before connecting: messages only arrive after the
// subscription below, and a reconnect must not add a second listener.
startWriting({ client, writer })

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

client.on('connect', function () {
    console.log('connected to', mqttUrl)
    client.subscribe(topic, function (err) {
        if (err) {
            console.log('Failure subscribing to topic', err)
            process.exit(1)
        }
        console.log('subscribed to', topic, 'writing to', process.env.RAW_DIR)
    })
})
