#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const {InfluxDB, Point} = require('@influxdata/influxdb-client')

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

// Automation decision event processor
function processAutomationDecisionEvent(data) {
    // Validate required fields for automation decision events
    if (!data._bot || !data._bot.name || !data.reason || !data.controlMode || !data._tz) {
        console.warn('Invalid automation decision event - missing required fields:', data)
        return []
    }

    // Extract service name from _bot.name
    const serviceName = data._bot.name

    // Create InfluxDB point for automation decision
    const point = new Point('automation_status')
        .tag('service', serviceName)
        .tag('type', 'status')
        .stringField('reason', data.reason)
        .stringField('controlMode', data.controlMode)
        .timestamp(new Date(data._tz))

    // Add optional fields if present
    if (data.manualOverrideExpires !== undefined) {
        if (data.manualOverrideExpires === null) {
            point.stringField('manualOverrideExpires', 'null')
        } else {
            point.intField('manualOverrideExpires', data.manualOverrideExpires)
        }
    }

    if (typeof data.heaterState === 'boolean') {
        point.booleanField('heaterState', data.heaterState)
    }

    if (typeof data.solarCirculation === 'boolean') {
        point.booleanField('solarCirculation', data.solarCirculation)
    }

    // Add temperature readings as seen by controller (correlation data)
    if (data.temperatures && typeof data.temperatures === 'object') {
        if (typeof data.temperatures.top === 'number') {
            point.floatField('temp_top_seen', data.temperatures.top)
        }
        if (typeof data.temperatures.bottom === 'number') {
            point.floatField('temp_bottom_seen', data.temperatures.bottom)
        }
        if (typeof data.temperatures.solar === 'number') {
            point.floatField('temp_solar_seen', data.temperatures.solar)
        }
        if (typeof data.temperatures.ambient === 'number') {
            point.floatField('temp_ambient_seen', data.temperatures.ambient)
        }
    }

    return [point]
}

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