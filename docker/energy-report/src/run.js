// When the reports are made: the missing months at start, then each month at
// 00:30 local on the 1st. `deps` holds the outside world, so tests can run it
// on a fake clock: { config, influx, now, sleep, send, log }.
import { HOUR, monthEnergy } from './hourly.js'
import { MAIN, LOADS, monthReport, toLineProtocol, monthsToCompute, shouldSendOnStart } from './report.js'
import { addMonths, lastReadyMonth, monthBounds, monthOf, nextRunAfter } from './time.js'
import { storedMonths, hourlyReadings, lastYearKwh, CHARGER, chargeSessions, storedCharges, chargerStart, carMinKw } from './influx.js'
import { telegramText } from './message.js'
import { CHARGES_TOPIC, chargeRow, chargeSummary, meterEnergy, toChargeLines } from './charges.js'

// The readings of a month are read with a week before and after it, so that a
// gap of up to a week across the start or the end of the month is spread over
// both months. The longest gap so far was 123 hours (2025-09-05 to 09-10).
const MARGIN = 7 * 24 * HOUR
// No meter here can count more than this in one hour. A larger increase is a
// meter swap or a bad reading. The same limit as the backfill.
const MAX_KWH_PER_HOUR = 50
// setTimeout cannot wait a whole month, so a long wait is cut into days.
const MAX_SLEEP = 24 * HOUR
const RETRY_AFTER = 15 * 60 * 1000
// How often the Ioniq charges are checked and the summary is published.
const CHARGES_EVERY = 15 * 60 * 1000

// Computes one month from the counters and writes it to energy_monthly. One
// query per meter, for this month only.
export async function computeMonth (deps, month) {
  const { influx, config, log } = deps
  const bounds = monthBounds(month)
  const energyOf = async (meter) => {
    const readings = await hourlyReadings(influx, meter, bounds.start - MARGIN, bounds.end + MARGIN)
    const energy = monthEnergy(readings, bounds, MAX_KWH_PER_HOUR)
    for (const { hour, from, to } of energy.dropped) {
      log(`${month} ${meter.name}: dropped a jump at ${new Date(hour).toISOString()}: ${from} -> ${to}`)
    }
    return energy
  }
  const main = await energyOf(MAIN)
  const loads = {}
  for (const meter of LOADS) loads[meter.name] = await energyOf(meter)
  const lastYear = await lastYearKwh(influx, addMonths(month, -12))
  const rows = monthReport({ month, main, loads, prices: config.prices, pricesFrom: config.pricesFrom, lastYear })
  // Stamped with the time of the write, not the month: so every write goes
  // into the current InfluxDB shard, and no old shard is rewritten. The
  // month is in the `month` tag.
  await influx.write(toLineProtocol(month, rows, deps.now()))
  log(`${month}: main ${main.kwh.toFixed(1)} kWh (day ${main.day.toFixed(1)}, night ${main.night.toFixed(1)}), written`)
  return rows
}

async function sleepUntil (deps, ms) {
  for (let left = ms - deps.now(); left > 0; left = ms - deps.now()) {
    await deps.sleep(Math.min(left, MAX_SLEEP))
  }
}

// Runs `fn` until it succeeds, waiting RETRY_AFTER after each failure, so the
// service never stops because InfluxDB is away.
async function retrying (deps, what, fn) {
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      deps.log(`${what} failed: ${err.message}; trying again in ${RETRY_AFTER / 60000} minutes`)
      await deps.sleep(RETRY_AFTER)
    }
  }
}

// At start: computes the months from config.firstMonth to the last ready
// month that are not stored yet, oldest first. Sends the previous month's
// message only as shouldSendOnStart allows. Returns the time it started from.
export async function catchUp (deps) {
  const now = deps.now()
  const stored = new Set(await storedMonths(deps.influx))
  const months = monthsToCompute({ stored, first: deps.config.firstMonth, last: lastReadyMonth(now) })
  if (months.length > 0) deps.log(`months to compute: ${months.length}, ${months[0]} to ${months.at(-1)}`)
  let lastRows
  for (const month of months) lastRows = await computeMonth(deps, month)
  if (shouldSendOnStart(now, months)) {
    await deps.send(telegramText(months.at(-1), lastRows, deps.config.dashboardUrl))
  }
  return { now, computed: months }
}

// Waits for the first report time after `after`, then computes the month
// that has just ended and sends its message. Returns the report time.
export async function runScheduled (deps, after) {
  const at = nextRunAfter(after)
  await sleepUntil(deps, at)
  const month = addMonths(monthOf(at), -1)
  const rows = await retrying(deps, `report of ${month}`, () => computeMonth(deps, month))
  await deps.send(telegramText(month, rows, deps.config.dashboardUrl))
  return at
}

// The service: the catch-up, then one report a month. `cycles` limits the
// monthly runs for tests.
export async function runForever (deps, cycles = Infinity) {
  let { now: after } = await retrying(deps, 'catch-up', () => catchUp(deps))
  for (let i = 0; i < cycles; i++) after = await runScheduled(deps, after)
}

// One Ioniq charge from the charger meter and the car, in three queries for
// the time of the charge only.
export async function computeCharge (deps, session) {
  const { influx, config } = deps
  const { first, maxW } = await chargerStart(influx, session.start, session.end)
  const hourly = first === undefined ? [] : await hourlyReadings(influx, CHARGER, session.start, session.end + 1)
  const carKw = await carMinKw(influx, session.start, session.end)
  return chargeRow(session, { meter: meterEnergy(session.start, first, hourly), carMinKw: carKw, meterMaxW: maxW }, config)
}

// Computes the charges of ioniq_sessions that are not in `known` yet
// (start -> row), writes each one to ioniq_charges as soon as it is done, and
// publishes the summary for Home Assistant, retained.
export async function refreshCharges (deps, known) {
  const sessions = await chargeSessions(deps.influx)
  let added = 0
  for (const session of sessions) {
    if (known.has(session.start) || !Number.isFinite(session.end)) continue
    // One charge that fails must not hold back the others or the summary;
    // it is tried again at the next refresh.
    try {
      const row = await computeCharge(deps, session)
      await deps.influx.write(toChargeLines([row]))
      known.set(session.start, row)
      added++
    } catch (err) {
      deps.log(`charge at ${session.start} failed: ${err.message}`)
    }
  }
  if (added > 0) deps.log(`ioniq charges: ${added} new, ${known.size} in all`)
  await deps.publish(CHARGES_TOPIC, JSON.stringify(chargeSummary([...known.values()], deps.now(), deps.config.pricesFrom)))
}

// The Ioniq charges: the stored ones are read once, then the new ones are
// computed and the summary is published every 15 minutes. A failure is
// logged and the next refresh tries again. `cycles` limits the runs for tests.
export async function runCharges (deps, cycles = Infinity) {
  let known = null
  for (let i = 0; i < cycles; i++) {
    try {
      known ??= await storedCharges(deps.influx)
      await refreshCharges(deps, known)
    } catch (err) {
      deps.log(`charges failed: ${err.message}; trying again in ${CHARGES_EVERY / 60000} minutes`)
    }
    await deps.sleep(CHARGES_EVERY)
  }
}
