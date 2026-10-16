#!/usr/bin/env node
// One-time build of a local outdoor estimate from past data.
// Usage: node backfill-estimate.js <collector|mower> <start YYYY-MM-DD> [end YYYY-MM-DD]
// The end defaults to today (UTC). It pauses 5 s between 30-day steps to keep
// the load on InfluxDB low. Run it inside the running container:
//   docker exec homy-weather-1 node backfill-estimate.js collector 2022-07-20
//   docker exec homy-weather-1 node backfill-estimate.js mower 2025-08-26

const fs = require('fs')
const {loadConfig} = require('./src/config')
const {createWriter} = require('./src/influx')
const {createReader} = require('./src/influx-query')
const {createEstimator} = require('./src/collector')
const {createMowerEstimator} = require('./src/mower')
const {backfillEstimate, pickEstimator} = require('./src/backfill')

const USAGE = 'Usage: node backfill-estimate.js <collector|mower> <start YYYY-MM-DD> [end YYYY-MM-DD]'

const ESTIMATORS = {
    collector: ({query, location}) => createEstimator({query, location}),
    mower: ({query}) => createMowerEstimator({query}),
}

// An unknown source is rejected by pickEstimator(), a missing or bad date by
// the date parsing in backfillEstimate().
async function main() {
    const [source, startDate, endDate = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
    const make = pickEstimator(ESTIMATORS, source)
    const config = loadConfig(process.env, (path) => fs.readFileSync(path, 'utf8'))
    const writer = createWriter(config.influx)
    const {estimateHours} = make({query: createReader(config.reader).query, location: config.location})
    try {
        const total = await backfillEstimate({
            estimateHours,
            writePoints: writer.writePoints,
            log: console,
            startDate,
            endDate,
            nowSec: Math.floor(Date.now() / 1000),
            pauseMs: 5000,
            label: source,
        })
        console.log(`Done: ${total} ${source} estimate hours`)
    } finally {
        await writer.close()
    }
}

main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`)
    console.error(USAGE)
    process.exit(1)
})
