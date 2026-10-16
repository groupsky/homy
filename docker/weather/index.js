#!/usr/bin/env node
// Polls Open-Meteo every 15 minutes and writes outdoor weather into InfluxDB.
// See CLAUDE.md for what is stored and who may use it.

const fs = require('fs')
const {loadConfig} = require('./src/config')
const {createWriter} = require('./src/influx')
const {fetchJson} = require('./src/fetch-json')
const {createPoller, msUntilNextRun} = require('./src/poller')
const {createReader} = require('./src/influx-query')
const {createEstimator} = require('./src/collector')
const {createMowerEstimator} = require('./src/mower')

let config
try {
    config = loadConfig(process.env, (path) => fs.readFileSync(path, 'utf8'))
} catch (error) {
    console.error(`Configuration error: ${error.message}`)
    process.exit(1)
}

const writer = createWriter(config.influx)
const {query} = createReader(config.reader)
const collector = createEstimator({query, location: config.location})
const mower = createMowerEstimator({query})
// Local outdoor estimates: the solar collector at night (#1735) and the docked mower battery (#1736).
const estimateHours = async (from, to) => [
    ...await collector.estimateHours(from, to),
    ...await mower.estimateHours(from, to),
]
const poller = createPoller({
    location: config.location,
    fetchJson,
    writePoints: writer.writePoints,
    log: console,
    estimateHours,
})

let timer = null

// pollOnce logs its own errors; the catch keeps an unexpected one from
// stopping the process, and the next run is always scheduled.
async function run() {
    try {
        await poller.pollOnce(Math.floor(Date.now() / 1000))
    } catch (error) {
        console.error(`Poll failed: ${error.message}`)
    }
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
