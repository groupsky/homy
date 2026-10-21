import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOUR, zoneAt, hourlyIncreases, monthEnergy } from './hourly.js'
import * as backfill from '../../../scripts/energy-backfill/lib.mjs'

const H = HOUR
const at = (iso) => Date.parse(iso)

test('zoneAt at the edges of the zones, on 1 November and 1 April', () => {
  const cases = [
    // 31 October is still summer: night 23:00-07:00 local (UTC+2 after the clock change)
    ['2026-10-31T20:00:00Z', 'day'], // 22:00 local
    ['2026-10-31T21:00:00Z', 'night'], // 23:00 local
    // 1 November: night 22:00-06:00 local
    ['2026-11-01T03:00:00Z', 'night'], // 05:00 local
    ['2026-11-01T04:00:00Z', 'day'], // 06:00 local
    ['2026-11-01T19:00:00Z', 'day'], // 21:00 local
    ['2026-11-01T20:00:00Z', 'night'], // 22:00 local
    // 31 March is still winter: night 22:00-06:00 local (UTC+3 after the clock change)
    ['2027-03-31T18:00:00Z', 'day'], // 21:00 local
    ['2027-03-31T19:00:00Z', 'night'], // 22:00 local
    // 1 April: night 23:00-07:00 local
    ['2027-04-01T03:00:00Z', 'night'], // 06:00 local
    ['2027-04-01T04:00:00Z', 'day'], // 07:00 local
    ['2027-04-01T19:00:00Z', 'day'], // 22:00 local
    ['2027-04-01T20:00:00Z', 'night'] // 23:00 local
  ]
  for (const [iso, zone] of cases) assert.equal(zoneAt(at(iso)), zone, iso)
})

test('hourlyIncreases counts only the increases of the counter', () => {
  const { energy, dropped } = hourlyIncreases([[0, 100], [H, 101.5], [2 * H, 103]], 50)
  assert.deepEqual([...energy], [[H, 1.5], [2 * H, 1.5]])
  assert.deepEqual(dropped, [])
})

test('hourlyIncreases: a rollback counts as no energy, and counting goes on from the lower value', () => {
  const { energy } = hourlyIncreases([[0, 575.66], [H, 570.59], [2 * H, 571.09]], 50)
  assert.deepEqual([...energy], [[H, 0], [2 * H, 0.5]])
})

test('hourlyIncreases: a step above 50 kWh/h counts as no energy, and is reported', () => {
  const { energy, dropped } = hourlyIncreases([[0, 10], [H, 12], [2 * H, 5000], [3 * H, 5001]], 50)
  assert.deepEqual([...energy], [[H, 2], [2 * H, 0], [3 * H, 1]])
  assert.deepEqual(dropped, [{ hour: 2 * H, from: 12, to: 5000 }])
})

test('hourlyIncreases spreads the increase of a gap evenly over the missing hours', () => {
  const { energy } = hourlyIncreases([[0, 10], [H, 11], [5 * H, 211]], 50)
  assert.deepEqual([...energy], [[H, 1], [2 * H, 50], [3 * H, 50], [4 * H, 50], [5 * H, 50]])
})

// 2025-11 in local time: 2025-10-31T22:00Z to 2025-11-30T22:00Z.
const NOV = { start: at('2025-10-31T22:00:00Z'), end: at('2025-11-30T22:00:00Z') }

test('monthEnergy counts only the hours that start in the month, and day + night = total', () => {
  const points = []
  // one reading per hour from 2 hours before the month to 2 hours after it, 1 kWh per hour
  for (let h = NOV.start - 2 * H, v = 1000; h <= NOV.end + 2 * H; h += H, v += 1) points.push([h, v])
  const result = monthEnergy(points, NOV, 50)
  assert.equal(result.kwh, 720)
  // 8 night hours on each of the 30 days
  assert.equal(result.night, 240)
  assert.equal(result.day, 480)
  assert.equal(result.day + result.night, result.kwh)
  assert.deepEqual(result.dropped, [])
})

test('monthEnergy: the first hour of the month takes the reading of the hour before it', () => {
  // 2025-11-01 00:00 local is a night hour
  const result = monthEnergy([[NOV.start - H, 100], [NOV.start, 102]], NOV, 50)
  assert.deepEqual([result.kwh, result.day, result.night], [2, 0, 2])
})

test('monthEnergy: a gap across the start of the month is spread over both months', () => {
  // 4 hours without readings, 2 before the month and 2 in it: 8 kWh, 2 kWh per hour
  const result = monthEnergy([[NOV.start - 3 * H, 100], [NOV.start + H, 108]], NOV, 50)
  assert.equal(result.kwh, 4)
})

test('monthEnergy: a gap across the end of the month is spread over both months', () => {
  const result = monthEnergy([[NOV.end - 3 * H, 100], [NOV.end + H, 110]], NOV, 50)
  // hours end-2h, end-1h are in the month; end, end+1h are not
  assert.equal(result.kwh, 5)
})

test('monthEnergy: a rollback and a jump in the month count as no energy; the jump is reported', () => {
  const s = NOV.start + 12 * H
  const result = monthEnergy([[s, 100], [s + H, 101], [s + 2 * H, 95], [s + 3 * H, 96], [s + 4 * H, 900], [s + 5 * H, 901]], NOV, 50)
  assert.equal(result.kwh, 3)
  assert.deepEqual(result.dropped, [{ hour: s + 4 * H, from: 96, to: 900 }])
})

test('monthEnergy gives 0 for a meter without readings', () => {
  assert.deepEqual(monthEnergy([], NOV, 50), { kwh: 0, day: 0, night: 0, dropped: [] })
})

// The copies must keep the rules of scripts/energy-backfill/lib.mjs.
test('zoneAt gives the same zone as the backfill for every hour from 2023-11 to 2028-01', () => {
  for (let t = at('2023-10-31T22:00:00Z'); t < at('2028-01-01T00:00:00Z'); t += H) {
    if (zoneAt(t) !== backfill.zoneAt(t)) assert.fail(`differs at ${new Date(t).toISOString()}`)
  }
})

// A counter with steady use, rollbacks, jumps and gaps, the same every run.
function messySeries () {
  const points = []
  let value = 5000
  let seed = 1757
  const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
  for (let h = at('2025-10-20T00:00:00Z'); h < at('2025-12-10T00:00:00Z'); h += H) {
    const r = random()
    if (r < 0.05) continue // no reading in this hour
    if (r < 0.06) value -= 5 * random() // rollback
    else if (r < 0.065) value += 500 // jump
    else value += 3 * random()
    points.push([h, value])
  }
  return points
}

test('hourlyIncreases gives the same hours as the backfill', () => {
  const points = messySeries()
  const ours = hourlyIncreases(points, 50)
  const theirs = backfill.hourlyIncreases(points, 50)
  assert.deepEqual([...ours.energy], [...theirs.energy])
  assert.deepEqual(ours.dropped, theirs.dropped)
  assert.ok(ours.dropped.length > 0, 'the series has jumps')
})

test('monthEnergy gives the same day and night totals as the backfill split', () => {
  const points = messySeries()
  const ours = monthEnergy(points, NOV, 50)
  const { day, night } = backfill.splitByZone(backfill.hourlyIncreases(points, 50).energy)
  const last = NOV.end - H
  assert.ok(Math.abs(ours.day - backfill.energyBetween(day, NOV.start, last)) < 1e-5)
  assert.ok(Math.abs(ours.night - backfill.energyBetween(night, NOV.start, last)) < 1e-5)
})
