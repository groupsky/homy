#!/usr/bin/env node
/* eslint-env node */
const { DMX } = require('dmx')
const mqtt = require('mqtt')
const { createMessageHandler } = require('./message-handler')
const { createUniverse } = require('./universe')

const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC
// Retained state of the DMX adapter, so a dead universe is visible on MQTT
// without reading the logs: {"state":"opening"|"online"|"offline", ...}.
const statusTopic = process.env.STATUS_TOPIC || 'homy/dmx-driver/status'
const deviceId = process.env.DMX_DEVICE ? parseInt(process.env.DMX_DEVICE) : 0

const client = mqtt.connect(mqttUrl, {
  clientId: process.env.MQTT_CLIENT_ID,
  // mqtt 5.16+ stops reconnecting after a refused login unless this is set.
  reconnectOnConnackError: true,
  // The broker publishes this if the service dies without saying goodbye.
  will: { topic: statusTopic, payload: JSON.stringify({ state: 'offline', error: 'dmx-driver is not running' }), qos: 1, retain: true }
})

let lastState = { state: 'opening' }
function publishState () {
  client.publish(statusTopic, JSON.stringify({ ...lastState, at: new Date().toISOString() }), { qos: 1, retain: true })
}

// Opening the adapter is retried with backoff instead of throwing at module
// load, so a missing or busy adapter no longer crash-loops the service (#1547).
const dmx = createUniverse({
  open: () => new DMX(deviceId),
  onState: (state) => {
    lastState = state
    publishState()
  }
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

client.on('connect', function () {
  console.log('connected to', mqttUrl)
  client.subscribe(topic, function (err) {
    if (err) {
      console.log('Failure subscribing to topic', err)
      process.exit(1)
    }
    console.log('subscribed to', topic)
  })
  // The will may have replaced the state while the client was away.
  publishState()
})

client.on('message', createMessageHandler(dmx))

dmx.start()
