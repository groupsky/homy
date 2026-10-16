#!/usr/bin/env node
// Polls Open-Meteo every 15 minutes and writes outdoor weather into InfluxDB.
// See CLAUDE.md for what is stored and who may use it.

const fs = require('fs')
const {loadConfig} = require('./src/config')
const {createWriter} = require('./src/influx')
const {fetchJson} = require('./src/fetch-json')
const {createPoller, msUntilNextRun} = require('./src/poller')

let config
try {
    config = loadConfig(process.env, (path) => fs.readFileSync(path, 'utf8'))
} catch (error) {
    console.error(`Configuration error: ${error.message}`)
    process.exit(1)
}

const writer = createWriter(config.influx)
const poller = createPoller({
    location: config.location,
    fetchJson,
    writePoints: writer.writePoints,
    log: console,
})

let timer = null

async function run() {
    await poller.pollOnce(Math.floor(Date.now() / 1000))
    timer = setTimeout(run, msUntilNextRun(Date.now()))
}

function shutdown() {
    clearTimeout(timer)
    writer.close().finally(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log(`Weather poller starting; location configured, writing to ${config.influx.bucket}`)
run()
