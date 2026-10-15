import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zoneAt, hourlyIncreases, addEnergy, splitByZone, priced, statisticsRows, energyBetween, liveAdjustment } from './lib.mjs'

const H = 3600 * 1000
const at = (iso) => Date.parse(iso)

test('zoneAt follows the month table in local time', () => {
  const cases = [
    // 1 April to 31 October: night 23:00-07:00 local
    ['2026-10-15T19:00:00Z', 'day'], // 22:00 local (UTC+3)
    ['2026-10-15T20:00:00Z', 'night'], // 23:00 local
    ['2026-10-16T03:00:00Z', 'night'], // 06:00 local
    ['2026-10-16T04:00:00Z', 'day'], // 07:00 local
    // after the clock change on 2026-10-25 it is still October
    ['2026-10-25T20:00:00Z', 'day'], // 22:00 local (UTC+2)
    ['2026-10-25T21:00:00Z', 'night'], // 23:00 local
    // 1 November to 31 March: night 22:00-06:00 local
    ['2026-11-01T03:00:00Z', 'night'], // 05:00 local (UTC+2)
    ['2026-11-01T04:00:00Z', 'day'], // 06:00 local
    ['2026-11-01T19:00:00Z', 'day'], // 21:00 local
    ['2026-11-01T20:00:00Z', 'night'], // 22:00 local
    // the clock changed on 2027-03-28, but it is still March
    ['2027-03-31T18:00:00Z', 'day'], // 21:00 local (UTC+3)
    ['2027-03-31T19:00:00Z', 'night'], // 22:00 local
    ['2027-04-01T03:00:00Z', 'night'], // 06:00 local
    ['2027-04-01T04:00:00Z', 'day'] // 07:00 local
  ]
  for (const [iso, zone] of cases) {
    assert.equal(zoneAt(at(iso)), zone, iso)
  }
})

test('zoneAt puts every hour of a year in the zone table', () => {
  let night = 0
  for (let t = at('2027-01-01T00:00:00Z'); t < at('2028-01-01T00:00:00Z'); t += H) {
    if (zoneAt(t) === 'night') night++
  }
  // 8 night hours on each of the 365 days
  assert.equal(night, 8 * 365)
})

test('hourlyIncreases gives each hour the increase since the last reading before it', () => {
  const { energy, dropped } = hourlyIncreases([[0, 100], [H, 101.5], [2 * H, 103]], 50)
  assert.deepEqual([...energy], [[H, 1.5], [2 * H, 1.5]])
  assert.deepEqual(dropped, [])
})

test('hourlyIncreases counts a step back as no energy, and counts on from the lower value', () => {
  const { energy } = hourlyIncreases([[0, 575.66], [H, 570.59], [2 * H, 571.09]], 50)
  assert.deepEqual([...energy], [[H, 0], [2 * H, 0.5]])
})

test('hourlyIncreases drops a jump larger than the meter can count, and reports it', () => {
  const { energy, dropped } = hourlyIncreases([[0, 10], [H, 12], [2 * H, 5000], [3 * H, 5001]], 50)
  assert.deepEqual([...energy], [[H, 2], [2 * H, 0], [3 * H, 1]])
  assert.deepEqual(dropped, [{ hour: 2 * H, from: 12, to: 5000 }])
})

test('hourlyIncreases spreads the increase evenly over hours without readings', () => {
  const { energy, dropped } = hourlyIncreases([[0, 10], [H, 11], [5 * H, 211]], 50)
  assert.deepEqual([...energy], [[H, 1], [2 * H, 50], [3 * H, 50], [4 * H, 50], [5 * H, 50]])
  assert.deepEqual(dropped, [])
})

test('hourlyIncreases drops a jump across a gap that is too large for its hours', () => {
  const { energy, dropped } = hourlyIncreases([[0, 10], [2 * H, 1000]], 50)
  assert.deepEqual([...energy], [[H, 0], [2 * H, 0]])
  assert.deepEqual(dropped, [{ hour: 2 * H, from: 10, to: 1000 }])
})

test('addEnergy sums hours that appear in more than one series', () => {
  const a = new Map([[0, 1], [H, 2]])
  addEnergy(a, new Map([[H, 3], [2 * H, 4]]))
  assert.deepEqual([...a], [[0, 1], [H, 5], [2 * H, 4]])
})

test('splitByZone puts each hour into the day or the night map', () => {
  const day = at('2026-10-15T09:00:00Z')
  const night = at('2026-10-15T21:00:00Z')
  const { day: d, night: n } = splitByZone(new Map([[day, 2], [night, 3]]))
  assert.deepEqual([...d], [[day, 2], [night, 0]])
  assert.deepEqual([...n], [[day, 0], [night, 3]])
})

test('priced keeps only the hours from the given time, times the price', () => {
  const cost = priced(new Map([[0, 2], [H, 3], [2 * H, 4]]), 0.5, H)
  assert.deepEqual([...cost], [[H, 1.5], [2 * H, 2]])
})

test('statisticsRows fills every hour up to the end, with a running sum from 0', () => {
  const rows = statisticsRows(new Map([[H, 1.5], [3 * H, 2]]), 5 * H)
  assert.deepEqual(rows, [
    { start: new Date(H).toISOString(), sum: 1.5 },
    { start: new Date(2 * H).toISOString(), sum: 1.5 },
    { start: new Date(3 * H).toISOString(), sum: 3.5 },
    { start: new Date(4 * H).toISOString(), sum: 3.5 }
  ])
})

test('statisticsRows: the first sum and each change from row to row are that hour energy', () => {
  const rows = statisticsRows(new Map([[0, 0.1], [H, 0.2], [2 * H, 0.3]]), 3 * H)
  assert.equal(rows[0].sum, 0.1)
  assert.ok(Math.abs(rows[1].sum - rows[0].sum - 0.2) < 1e-9)
  assert.ok(Math.abs(rows[2].sum - rows[1].sum - 0.3) < 1e-9)
})

test('statisticsRows never writes the end hour or later', () => {
  const rows = statisticsRows(new Map([[0, 1], [H, 1], [2 * H, 1]]), 2 * H)
  assert.deepEqual(rows.map((r) => r.start), [new Date(0).toISOString(), new Date(H).toISOString()])
})

test('statisticsRows gives no rows for no energy', () => {
  assert.deepEqual(statisticsRows(new Map(), 5 * H), [])
})

test('energyBetween sums the hours in the range, both ends included', () => {
  assert.equal(energyBetween(new Map([[0, 1], [H, 2], [2 * H, 4], [3 * H, 8]]), H, 2 * H), 6)
})

test('liveAdjustment makes the first live row go on from the last imported sum', () => {
  // imported sums end at 1000; the meter counted 0.43 kWh in the first live
  // hour; the live sum there started from 0 and shows 0.40
  const adjustment = liveAdjustment(1000, 0.43, 0.4)
  assert.equal(adjustment, 1000.03)
  // after the adjustment the live sum is 1000.43: a second run adds nothing
  assert.equal(liveAdjustment(1000, 0.43, 0.4 + adjustment), 0)
})
