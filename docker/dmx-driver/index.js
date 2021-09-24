#!/usr/bin/env node
/* eslint-env node */
const DMX = require('dmx')
const mqtt = require('mqtt')

const mqttUrl = process.env.BROKER
const topic = process.env.TOPIC

const dmxDriver = process.env.DMX_DRIVER
const dmxPort = process.env.DMX_PORT

const dmx = new DMX()
const universe = dmx.addUniverse('homy', dmxDriver, dmxPort)

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

const st = {
  1: 0,
  2: 0,
  3: 0,
  4: 0
}

client.on('message', function (topic, message) {
  const { inputs } = JSON.parse(message)
  st['1'] = (inputs & 32) ? 128 : 0
  st['2'] = (inputs & 512) ? 128 : 0
  st['3'] = (inputs & 2048) ? 128 : 0
  universe.update({ ...st })
  console.log(st)
})

universe.update({ ...st })
