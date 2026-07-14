#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')

const { MongoClient } = require('mongodb')
const { buildRecord } = require('./record')
const { ttlIndexArgsFromEnv } = require('./ttl')
const mqttUrl = process.env.BROKER
const mongoUrl = process.env.MONGODB_URL
const collection = process.env.COLLECTION
const topic = process.env.TOPIC
const mongoUser = getFileEnv('MONGODB_USERNAME')
const mongoPassword = getFileEnv('MONGODB_PASSWORD')

const client = mqtt.connect(mqttUrl, {
    clientId: process.env.MQTT_CLIENT_ID
})

function getFile(filePath) {
    if (filePath) {
        const fs = require('fs');

        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath);
            }
        } catch (err) {
            console.error('Failed to read file', filePath, err);
        }
    }
    return null;
}

function getFileEnv(envVariable) {
    const origVar = process.env[envVariable];
    const fileVar = process.env[envVariable + '_FILE'];
    if (fileVar) {
        const file = getFile(fileVar);
        if (file) {
            return file.toString().split(/\r?\n/)[0].trim();
        }
    }
    return origVar;
}

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

const mongoPromise = MongoClient.connect(mongoUrl, {
    auth: {
        username: mongoUser,
        password: mongoPassword
    }
})

client.on('connect', function () {
    console.log('connected to', mqttUrl)
    client.subscribe(topic, function (err) {
        if (err) {
            console.log('Failure subscribing to topic', err)
            process.exit(1)
        }
        console.log('subscribed to', topic)

        mongoPromise.then(async (mongoClient) => {
            console.log('connected to', mongoUrl)
            const db = mongoClient.db()
            const col = db.collection(collection)

            // Ensure the retention (TTL) index when configured. Idempotent, so
            // it is safe on every (re)connect. A failure here must not stop
            // archiving, so it is logged rather than fatal.
            const ttlArgs = ttlIndexArgsFromEnv(process.env)
            if (ttlArgs) {
                try {
                    await col.createIndex(...ttlArgs)
                    console.log('ensured TTL index', ttlArgs[1].name,
                        'expireAfterSeconds', ttlArgs[1].expireAfterSeconds)
                } catch (err) {
                    console.error('Failure ensuring TTL index (archiving continues)', err)
                }
            }

            client.on('message', async function (topic, message) {
                const record = buildRecord(topic, message)
                try {
                    await col.insertOne(record)
                } catch (err) {
                    console.error('Failure writing to mongo', err)
                    process.exit(1)
                }
            })
        })
    })
})
