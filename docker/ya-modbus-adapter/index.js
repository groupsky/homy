#!/usr/bin/env node
/* eslint-env node */

const fs = require('fs')
const mqtt = require('mqtt')
const {createDayFileWriter} = require('./day-file-writer')
const {createAdapter, devicesFromBridgeConfig} = require('./adapter')

// The first line of the file named by NAME_FILE, or else NAME.
function fileEnv(name) {
  const file = process.env[`${name}_FILE`]
  if (file) return fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim()
  return process.env[name]
}

// The bridge's own config file, mounted at the same path as in the bridge:
// the devices, their addresses and drivers, and the topic prefix.
const BRIDGE_CONFIG = '/etc/ya-modbus/config.json'

const mqttUrl = process.env.BROKER
const publishTopic = process.env.TOPIC
if (!mqttUrl || !publishTopic) {
  console.error('BROKER and TOPIC must be set')
  process.exit(1)
}

// Throws at startup on a driver without a mapping.
const devices = devicesFromBridgeConfig(JSON.parse(fs.readFileSync(BRIDGE_CONFIG, 'utf8')))

// Throws, and so stops the service at startup, when RAW_DIR, COLLECTION or
// SERVICE_NAME is missing or the stream directory cannot be written.
const writer = createDayFileWriter({
  root: process.env.RAW_DIR,
  stream: process.env.COLLECTION,
  service: process.env.SERVICE_NAME,
})
writer.ensureWritable()

// MongoDB is optional, so the #1622 cut-over only removes the MONGODB_*
// variables. As in the old reader, readings that arrive before the
// connection is up are not inserted.
let collection = null
let insert = null
if (process.env.MONGODB_URL) {
  const {MongoClient} = require('mongodb')
  const {connectWithRetry} = require('./mongo-connect')
  connectWithRetry({
    connect: () => MongoClient.connect(process.env.MONGODB_URL, {
      auth: {username: fileEnv('MONGODB_USERNAME'), password: fileEnv('MONGODB_PASSWORD')},
    }),
  })
    .then((client) => {
      collection = client.db().collection(process.env.COLLECTION)
    })
  insert = (doc) => collection && collection.insertOne(doc)
}

const client = mqtt.connect(mqttUrl)

const handle = createAdapter({
  devices,
  publishTopic,
  publish: (topic, payload) => client.publish(topic, payload),
  writer,
  insert,
})

// Registered once, before connecting, so a reconnect does not add a second
// listener.
client.on('message', handle)

client.on('connect', () => {
  const topics = devices.map((device) => device.topic)
  client.subscribe(topics, (err) => {
    if (err) {
      console.error('Failure subscribing to', topics, err)
      process.exit(1)
    }
    console.log('subscribed to', topics.join(', '), 'publishing to', publishTopic)
  })
})

// As in mqtt-ndjson: a lost broker connection ends the process and Docker
// starts it again.
for (const event of ['close', 'offline', 'error']) {
  client.on(event, (err) => {
    console.error(`mqtt ${event}`, err ?? '')
    process.exit(1)
  })
}

// Node as PID 1 ignores SIGTERM without a handler (#1680).
process.on('SIGTERM', () => {
  console.error('Received SIGTERM, exiting')
  process.exit(0)
})
