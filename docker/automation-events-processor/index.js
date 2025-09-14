#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const {InfluxDB} = require('@influxdata/influxdb-client')
const {processAutomationDecisionEvent} = require('./processor')

// Environment configuration
const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC || 'homy/automation/+/status'
const influxUrl = process.env.INFLUXDB_URL
const influxToken = process.env.INFLUXDB_TOKEN || `${process.env.INFLUXDB_USERNAME}:${process.env.INFLUXDB_PASSWORD}`
const influxOrg = process.env.INFLUXDB_ORG || ''
const influxBucket = process.env.INFLUXDB_BUCKET || `${process.env.INFLUXDB_DATABASE}/${process.env.INFLUXDB_RP || 'autogen'}`
const tags = process.env.TAGS ? JSON.parse(process.env.TAGS) : []

// Initialize clients
const client = mqtt.connect(mqttUrl, {
    clientId: process.env.MQTT_CLIENT_ID || 'automation-events-processor'
})

const writeApi = new InfluxDB({url: influxUrl, token: influxToken})
    .getWriteApi(influxOrg, influxBucket, 'ms', {
        defaultTags: tags
    })


// MQTT connection handlers
client.on('connect', function () {
    console.log('Connected to MQTT broker:', mqttUrl)
    client.subscribe(topic, function (err) {
        if (err) {
            console.error('Failed to subscribe to topic:', topic, err)
            process.exit(1)
        }
        console.log('Subscribed to automation events:', topic)
    })
})

client.on('reconnect', function () {
    console.log('Reconnected to MQTT broker')
})

client.on('close', function () {
    console.log('MQTT connection closed')
    process.exit(1)
})

client.on('disconnect', function () {
    console.log('MQTT disconnected')
    process.exit(1)
})

client.on('error', function (err) {
    console.error('MQTT error:', err)
    process.exit(1)
})

client.on('offline', function () {
    console.log('MQTT offline')
    process.exit(1)
})

// Process automation decision events
client.on('message', function (topic, message) {
    try {
        const data = JSON.parse(message.toString())

        console.log('Processing automation event from:', topic)

        const points = processAutomationDecisionEvent(data)

        if (points.length > 0) {
            writeApi.writePoints(points)
            console.log('Wrote', points.length, 'points to InfluxDB for service:', data._bot?.name)
        } else {
            console.warn('No points generated for event from:', topic)
        }
    } catch (error) {
        console.error('Error processing automation event:', error, 'Raw message:', message.toString())
    }
})

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down automation events processor...')
    writeApi.close()
    client.end()
    process.exit(0)
})

console.log('Automation Events Processor starting...')
console.log('MQTT Topic:', topic)
console.log('InfluxDB URL:', influxUrl)