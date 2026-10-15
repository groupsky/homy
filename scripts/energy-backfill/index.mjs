#!/usr/bin/env node
// Backfills the Energy dashboard's hourly statistics from the meter readings
// in InfluxDB, up to the hour the new counters were deployed (#1737), and
// moves the live sums so that they go on from the imported ones. A dry run
// (the default) prints what it would do; --apply writes. Safe to run again.
// See docs/energy-dashboard.md.
import { existsSync, readFileSync } from 'node:fs'
import { connect, readToken } from '../ha-provision/ha-websocket.mjs'
import { hourlyIncreases, addEnergy, splitByZone, priced, statisticsRows, energyBetween, liveAdjustment } from './lib.mjs'

// Fixed on purpose, not configurable: the script talks to HA and InfluxDB over
// the automation network and takes its credentials from Docker secret mounts.
const HA_URL = 'ws://ha:8123/api/websocket'
const TOKEN_FILE = '/run/secrets/ha_provision_token'
const INFLUX_URL = 'http://influxdb:8086/query'
const INFLUX_DB = 'homy'
const INFLUX_USER_FILE = '/run/secrets/influxdb_read_user'
const INFLUX_PASSWORD_FILE = '/run/secrets/influxdb_read_user_password'
const ENERGY = new URL('../../config/home-assistant/energy.json', import.meta.url)

const HOUR = 3600 * 1000
// The hour the new counters were deployed. Imported rows end before it, and
// the live statistics start in it or later.
const END = Date.parse('2026-10-15T14:00:00Z')
// Costs are imported only from the start of the current prices, 2026-07-01
// 00:00 local time. Earlier prices were different and in BGN.
const COST_FROM = Date.parse('2026-06-30T21:00:00Z')
// No meter here can count more than this in one hour. A larger increase is a
// meter swap or a bad reading.
const MAX_KWH_PER_HOUR = 50
const IMPORT_CHUNK = 1000

const GRID_TARIFFS = { day: 'sensor.grid_import_day', night: 'sensor.grid_import_night' }

// Where the meter readings of each dashboard counter are in InfluxDB. Each
// entry is one physical meter, picked by its tags, so that a meter swap is
// never counted as use. `power_meter.total` holds the counters of the
// modbus-serial meters since 2020-12.
const meter = (measurement, bus, device, type, field) => ({ measurement, bus, device, type, field })
const secondary = (device, type) => meter('power_meter', 'secondary', device, type, 'total')
const GRID_SOURCES = [
  // The main meter was swapped on 2023-10-15/16: the DDS024MR became the
  // heat pump meter, and the heat pump's SDM630 became the main meter.
  meter('power_meter', 'primary', 'main', 'dds024mr', 'total'),
  meter('power_meter', 'primary', 'main', 'sdm630', 'total')
]
const DEVICE_SOURCES = {
  'sensor.water_pump_energy': [secondary('water_pump', 'ex9em')],
  'sensor.oven_energy': [secondary('oven', 'dds519mr')],
  'sensor.stove_energy': [secondary('stove', 'dds519mr')],
  'sensor.dishwasher_energy': [secondary('dishwasher', 'dds519mr')],
  'sensor.laundry_energy': [secondary('laundry', 'dds519mr')],
  'sensor.boiler_energy': [secondary('boiler', 'dds519mr')],
  'sensor.heat_pump_energy': [
    meter('sdm630raw', 'tetriary', 'heat_pump', 'sdm630', 'total_import_kwh'),
    meter('power_meter', 'tetriary', 'heat_pump', 'dds024mr', 'total')
  ],
  'sensor.microwave_energy': [secondary('microwave', 'or-we-514')],
  'sensor.ev_charger_energy': [meter('xymd1', 'monitoring', 'charger', 'or-we-526', 'tot_act')]
}
// The first year with readings.
const FIRST_YEAR = 2020

function secret (file) {
  return readFileSync(file, 'utf8').trim()
}

async function influx (query) {
  const params = new URLSearchParams({
    db: INFLUX_DB,
    q: query,
    epoch: 'ms',
    u: secret(INFLUX_USER_FILE),
    p: secret(INFLUX_PASSWORD_FILE)
  })
  const response = await fetch(`${INFLUX_URL}?${params}`)
  if (!response.ok) throw new Error(`InfluxDB: HTTP ${response.status}`)
  const body = await response.json()
  const result = body.results?.[0]
  if (result?.error) throw new Error(`InfluxDB: ${result.error}`)
  return result?.series?.[0]?.values ?? []
}

// The last reading of each hour, one year per query to keep each query small.
// A reading of 0 or less is a bad reading, not a counter value.
async function hourlyReadings ({ measurement, bus, device, type, field }, untilMs) {
  const points = []
  for (let year = FIRST_YEAR; Date.UTC(year, 0, 1) < untilMs; year++) {
    const start = Date.UTC(year, 0, 1)
    const stop = Math.min(Date.UTC(year + 1, 0, 1), untilMs)
    points.push(...await influx(
      `SELECT last("${field}") FROM "${measurement}" WHERE "bus" = '${bus}' AND "device.name" = '${device}' ` +
      `AND "device.type" = '${type}' AND "${field}" > 0 AND time >= ${start}ms AND time < ${stop}ms ` +
      'GROUP BY time(1h) fill(none)'
    ))
  }
  return points
}

// The hourly energy of one counter, from all of its meters, up to `untilMs`.
async function counterEnergy (name, sources, untilMs) {
  const energy = new Map()
  for (const source of sources) {
    const { energy: part, dropped } = hourlyIncreases(await hourlyReadings(source, untilMs), MAX_KWH_PER_HOUR)
    for (const { hour, from, to } of dropped) {
      console.log(`${name}: dropped a jump at ${new Date(hour).toISOString()}: ${from} -> ${to}`)
    }
    addEnergy(energy, part)
  }
  return energy
}

function energyTargets (energyConfig) {
  const grid = energyConfig.data.energy_sources.filter((s) => s.type === 'grid')
  const price = (statisticId) => {
    const source = grid.find((s) => s.stat_energy_from === statisticId)
    if (typeof source?.number_energy_price !== 'number') {
      throw new Error(`energy.json has no grid source ${statisticId} with a fixed price`)
    }
    return source.number_energy_price
  }
  const devices = energyConfig.data.device_consumption.map((d) => d.stat_consumption)
  for (const id of devices) {
    if (!DEVICE_SOURCES[id]) throw new Error(`no InfluxDB source for the device counter ${id}`)
  }
  return { prices: { day: price(GRID_TARIFFS.day), night: price(GRID_TARIFFS.night) }, devices }
}

// Every statistic to backfill, with its hourly energy (or cost) up to `untilMs`.
async function buildTargets (untilMs) {
  const { prices, devices } = energyTargets(JSON.parse(readFileSync(ENERGY, 'utf8')))
  const kwh = { unit: 'kWh', unitClass: 'energy' }
  const eur = { unit: 'EUR', unitClass: null }
  const targets = []
  const tariffs = splitByZone(await counterEnergy('grid', GRID_SOURCES, untilMs))
  for (const zone of ['day', 'night']) {
    const id = GRID_TARIFFS[zone]
    targets.push({ id, ...kwh, energy: tariffs[zone] })
    targets.push({ id: `${id}_cost`, ...eur, energy: priced(tariffs[zone], prices[zone], COST_FROM) })
  }
  for (const id of devices) {
    targets.push({ id, ...kwh, energy: await counterEnergy(id, DEVICE_SOURCES[id], untilMs) })
  }
  return targets
}

// The first live hourly row at or after END, or undefined.
async function firstLiveRow (ha, id, untilMs) {
  const result = await ha.call({
    type: 'recorder/statistics_during_period',
    start_time: new Date(END).toISOString(),
    end_time: new Date(untilMs).toISOString(),
    statistic_ids: [id],
    period: 'hour',
    types: ['sum']
  })
  return (result[id] ?? []).find((row) => row.sum !== null)
}

async function backfill (ha, target, untilMs, apply) {
  const { id, unit, unitClass, energy } = target
  const rows = statisticsRows(energy, END)
  if (rows.length === 0) {
    console.log(`${id}: no readings before ${new Date(END).toISOString()}, nothing to import`)
    return true
  }
  if (!ha) {
    console.log(`${id}: ${rows.length} rows from ${rows[0].start}, imported total ${rows.at(-1).sum} ${unit} (no token: live statistics not read)`)
    return true
  }
  const live = await firstLiveRow(ha, id, untilMs)
  if (!live) {
    // Without a live row the first live sum would start again from 0, below
    // the imported sums: a negative step. Run again once the meter counted.
    console.error(`${id}: no live statistics yet - run again after the meter has counted some energy`)
    return false
  }
  const last = rows.at(-1).sum
  const sinceEnd = energyBetween(energy, END, live.start)
  const adjustment = liveAdjustment(last, sinceEnd, live.sum)
  console.log(
    `${id}: ${rows.length} rows from ${rows[0].start}, imported total ${last} ${unit}; ` +
    `first live row ${new Date(live.start).toISOString()} sum ${live.sum}, ` +
    `meter since the deploy ${sinceEnd}; ${apply ? 'adjust' : 'would adjust'} live sums by ${adjustment}`
  )
  if (!apply) return true
  const metadata = {
    has_sum: true,
    mean_type: 0,
    name: null,
    source: 'recorder',
    statistic_id: id,
    unit_class: unitClass,
    unit_of_measurement: unit
  }
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
    await ha.call({ type: 'recorder/import_statistics', metadata, stats: rows.slice(i, i + IMPORT_CHUNK) })
  }
  if (Math.abs(adjustment) >= 0.001) {
    await ha.call({
      type: 'recorder/adjust_sum_statistics',
      statistic_id: id,
      start_time: new Date(live.start).toISOString(),
      adjustment,
      adjustment_unit_of_measurement: unit
    })
  }
  return true
}

async function main () {
  const apply = process.argv.slice(2).includes('--apply')
  // Only complete hours: the current hour is still being counted.
  const untilMs = Math.floor(Date.now() / HOUR) * HOUR
  const targets = await buildTargets(untilMs)
  // A dry run without a token still shows what would be imported.
  const ha = apply || existsSync(TOKEN_FILE) ? await connect(HA_URL, readToken(TOKEN_FILE)) : undefined
  try {
    let ok = true
    for (const target of targets) ok = (await backfill(ha, target, untilMs, apply)) && ok
    return ok ? 0 : 1
  } finally {
    ha?.close()
  }
}

main().then(
  (code) => { process.exitCode = code },
  // Line breaks are removed so an error carrying text from HA stays one log line.
  (err) => { console.error(String(err.message).replace(/\r/g, '').replace(/\n/g, '')); process.exitCode = 1 }
)
