#!/usr/bin/env node
/* eslint-env node */

const mqtt = require('mqtt')

const { MongoClient } = require('mongodb')
const mqttUrl = process.env.BROKER
const mongoUrl = process.env.MONGODB_URL
const collection = process.env.COLLECTION
const topic = process.env.TOPIC
const query = process.env.QUERY ? JSON.parse(process.env.QUERY) : {}
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

function formatUnicorn (format, values) {
    let str = format.toString()

    if (typeof values === 'object') {
        for (let key in values) {
            if (!values.hasOwnProperty(key)) continue
            const value = values[key]
            const tt = typeof value
            if ('string' !== tt && 'number' !== tt) continue
            str = str.replace(new RegExp('\\{' + key + '\\}', 'gi'), value)
        }
    }

    return str
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
        user: mongoUser,
        password: mongoPassword
    }
})

client.on('connect', function () {
    console.log('connected to', mqttUrl)

    mongoPromise.then((mongoClient) => {
        console.log('connected to', mongoUrl)
        const db = mongoClient.db()
        const col = db.collection(collection)

        const cursor = col.find(query)
            .sort({_id: -1})

        let count = -1
        let processed = 0
        let lastLog = 0

        function log(force = false) {
            if (force || Date.now() - lastLog > 60000) {
                lastLog = Date.now()
                console.log(`processed ${processed}/${count}`)
            }
        }

        cursor.on('data', function (doc) {
            client.publish(formatUnicorn(topic, doc), JSON.stringify(doc))

            processed++

            log()
        })

        cursor.on('end', () => {
            log(true)
            console.log('cursor end')
            client.end()
        })
        cursor.on('close', () => {
            log(true)
            console.log('cursor close')
            client.end()
        })

        cursor.count().then(function (c) {
            count = c
            log(true)
        }, function (err) {
            console.error('Error getting count', err)
            process.exit(1)
        })
    })
})
