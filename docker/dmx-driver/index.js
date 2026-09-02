#!/usr/bin/env node
/* eslint-env node */
const { DMX } = require('dmx')
const mqtt = require('mqtt')
const { createMessageHandler } = require('./message-handler')

const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC

const dmx = new DMX(process.env.DMX_DEVICE ? parseInt(process.env.DMX_DEVICE) : 0)

const client = mqtt.connect(mqttUrl, {
  clientId: process.env.MQTT_CLIENT_ID
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
})

client.on('message', createMessageHandler(dmx))

dmx.setHz(20)
dmx.step(5)
// this also starts the update thread
dmx.set(0)
