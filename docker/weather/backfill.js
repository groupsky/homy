#!/usr/bin/env node
// One-time load of past weather into InfluxDB.
// Usage: node backfill.js <start YYYY-MM-DD> [end YYYY-MM-DD] [model]
// The end defaults to today (UTC) and the model to era5_seamless.
// Run it inside the running container, which has the location and the secrets:
//   docker exec homy-weather-1 node backfill.js 2020-12-01

const fs = require('fs')
const {loadConfig} = require('./src/config')
const {createWriter} = require('./src/influx')
const {fetchJson} = require('./src/fetch-json')
const {backfill} = require('./src/backfill')

async function main() {
    const [startDate, endDate = new Date().toISOString().slice(0, 10), model = 'era5_seamless'] = process.argv.slice(2)
    if (!startDate) {
        console.error('Usage: node backfill.js <start YYYY-MM-DD> [end YYYY-MM-DD] [model]')
        process.exit(2)
    }
    const config = loadConfig(process.env, (path) => fs.readFileSync(path, 'utf8'))
    const writer = createWriter(config.influx)
    try {
        const total = await backfill({
            location: config.location,
            fetchJson,
            writePoints: writer.writePoints,
            log: console,
            model,
            startDate,
            endDate,
            nowSec: Math.floor(Date.now() / 1000),
        })
        console.log(`Done: ${total} hours from ${model}`)
    } finally {
        await writer.close()
    }
}

main().catch((error) => {
    console.error(`Backfill failed: ${error.message}`)
    process.exit(1)
})
