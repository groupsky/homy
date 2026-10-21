#!/usr/bin/env node
// Monthly energy report: computes each month from the meter counters into the
// InfluxDB measurement energy_monthly, and sends a short Telegram message on
// the 1st. See CLAUDE.md.
import { loadConfig } from './src/config.js'
import { createInflux } from './src/influx.js'
import { sendTelegram } from './src/message.js'
import { runForever } from './src/run.js'

let config
try {
  config = loadConfig()
} catch (err) {
  console.error(`Configuration error: ${err.message}`)
  process.exit(1)
}

const log = (message) => console.log(message)
const deps = {
  config,
  influx: createInflux(config.influx),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  send: (text) => sendTelegram({ url: config.telegramUrl, log }, text),
  log
}

// Nothing is lost on a stop: a month is written in one request, and the next
// start computes the months that are missing.
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

console.log(`energy-report starting: months from ${config.firstMonth}, costs from ${config.pricesFrom}`)
runForever(deps).catch((err) => {
  console.error(`energy-report stopped: ${err.stack ?? err}`)
  process.exit(1)
})
