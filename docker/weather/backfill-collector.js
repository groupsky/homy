#!/usr/bin/env node
// One-time build of the collector night estimate (#1735) from past data.
// Usage: node backfill-collector.js <start YYYY-MM-DD> [end YYYY-MM-DD]
// The end defaults to today (UTC). Run it inside the running container:
//   docker exec homy-weather-1 node backfill-collector.js 2022-07-20

const fs = require('fs')
const {loadConfig} = require('./src/config')
const {createWriter} = require('./src/influx')
const {createReader} = require('./src/influx-query')
const {createEstimator} = require('./src/collector')
const {backfillEstimate} = require('./src/backfill')

const USAGE = 'Usage: node backfill-collector.js <start YYYY-MM-DD> [end YYYY-MM-DD]'

// A missing or bad date is rejected by the date parsing in backfillEstimate().
async function main() {
    const [startDate, endDate = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
    const config = loadConfig(process.env, (path) => fs.readFileSync(path, 'utf8'))
    const writer = createWriter(config.influx)
    const {estimateHours} = createEstimator({query: createReader(config.reader).query, location: config.location})
    try {
        const total = await backfillEstimate({
            estimateHours,
            writePoints: writer.writePoints,
            log: console,
            startDate,
            endDate,
            nowSec: Math.floor(Date.now() / 1000),
        })
        console.log(`Done: ${total} collector estimate hours`)
    } finally {
        await writer.close()
    }
}

main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`)
    console.error(USAGE)
    process.exit(1)
})
