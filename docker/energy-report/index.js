#!/usr/bin/env node
// Monthly energy report: computes each month from the meter counters into the
// InfluxDB measurement energy_monthly, and sends a short Telegram message on
// the 1st. Also the Ioniq charges: ioniq_charges and a retained MQTT summary
// for Home Assistant. See CLAUDE.md.
import { loadConfig } from './src/config.js'
import { createInflux } from './src/influx.js'
import { sendTelegram } from './src/message.js'
import { publishRetained } from './src/mqtt.js'
import { runForever, runCharges } from './src/run.js'

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
  publish: (topic, payload) => publishRetained(config.mqtt, topic, payload),
  log
}

// Nothing is lost on a stop: a month and a charge are each written in one
// request, and the next start computes the ones that are missing.
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

console.log(`energy-report starting: months from ${config.firstMonth}, costs from ${config.pricesFrom}`)
// The monthly report and the charges run side by side.
Promise.all([runForever(deps), runCharges(deps)]).catch((err) => {
  console.error(`energy-report stopped: ${err.stack ?? err}`)
  process.exit(1)
})
