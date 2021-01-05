#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')

const { MongoClient } = require('mongodb')
const mqttUrl = process.env.BROKER
const mongoUrl = process.env.DATABASE
const collection = process.env.COLLECTION
const topic = process.env.TOPIC

const client = mqtt.connect(mqttUrl, {
    clientId: process.env.MQTT_CLIENT_ID
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

MongoClient.connect(mongoUrl)
    .then((mongoClient) => {
        console.log('connected to', mongoUrl)
        const db = mongoClient.db()
        const col = db.collection(collection)

        client.on('message', function (topic, message) {
            const data = JSON.parse(message)
            col.insertOne(data, function (err, rec) {
                if (err) {
                    console.error('Failure writing to mongo', err)
                    process.exit(1)
                }
            })
        })
    })
