#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')
const {InfluxDB} = require('@influxdata/influxdb-client')
const {processAutomationDecisionEvent} = require('./processor')

// Utility function to read Docker secrets or environment variables
function loadSecret(name) {
    const fileEnvVar = `${name}_FILE`
    const directEnvVar = name

    if (process.env[fileEnvVar]) {
        try {
            const fs = require('fs')
            return fs.readFileSync(process.env[fileEnvVar], 'utf8').trim()
        } catch (error) {
            console.error(`Failed to read secret from file ${process.env[fileEnvVar]}:`, error.message)
            return null
        }
    } else if (process.env[directEnvVar]) {
        return process.env[directEnvVar]
    }

    return null
}

// Environment configuration
const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC || 'homy/automation/+/status'
const influxUrl = process.env.INFLUXDB_URL
const influxUsername = loadSecret('INFLUXDB_USERNAME')
const influxPassword = loadSecret('INFLUXDB_PASSWORD')
const influxToken = process.env.INFLUXDB_TOKEN || `${influxUsername}:${influxPassword}`
const influxOrg = process.env.INFLUXDB_ORG || ''
const influxBucket = process.env.INFLUXDB_BUCKET || `${process.env.INFLUXDB_DATABASE}/${process.env.INFLUXDB_RP || 'autogen'}`
const tags = process.env.TAGS ? JSON.parse(process.env.TAGS) : []

// Validate configuration
if (!mqttUrl) {
    console.error('ERROR: BROKER is required')
    process.exit(1)
}

if (!influxUrl) {
    console.error('ERROR: INFLUXDB_URL is required')
    process.exit(1)
}

if (!influxUsername || !influxPassword) {
    console.error('ERROR: InfluxDB credentials are required (set via INFLUXDB_USERNAME/INFLUXDB_PASSWORD or INFLUXDB_USERNAME_FILE/INFLUXDB_PASSWORD_FILE)')
    process.exit(1)
}

if (!process.env.INFLUXDB_DATABASE) {
    console.error('ERROR: INFLUXDB_DATABASE is required')
    process.exit(1)
}

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
console.log('MQTT Broker:', mqttUrl)
console.log('MQTT Topic:', topic)
console.log('InfluxDB URL:', influxUrl)
console.log('InfluxDB Database:', process.env.INFLUXDB_DATABASE)
console.log('InfluxDB Username:', influxUsername ? 'configured' : 'missing')
console.log('InfluxDB Bucket:', influxBucket)
console.log('Default Tags:', tags)