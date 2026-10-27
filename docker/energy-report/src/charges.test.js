import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meterEnergy, chargeRow, toChargeLines, chargeSummary, CHARGES_TOPIC } from './charges.js'

const H = 3600 * 1000
const at = (iso) => Date.parse(iso)
const config = { prices: { day: 0.2, night: 0.1 }, pricesFrom: '2026-07' }

// A made-up overnight session of the ioniq-sessions bot, as read from ioniq_sessions.
const session = (over = {}) => ({
  start: at('2026-11-03T18:10:00Z'),
  end: at('2026-11-04T05:50:00Z'),
  duration_sec: 36000,
  duration_is_charge: true,
  energy_in_kwh: 10,
  soc_start: 30,
  soc_end: 70,
  power_avg_kw: 1,
  ...over
})

test('meterEnergy splits the counter increase into the hours of the charge, by tariff zone', () => {
  // November: night is 22:00-06:00 local (UTC+2), so 20:00-04:00 UTC.
  const start = at('2026-11-03T19:30:00Z')
  const first = 100
  const hourly = [
    [at('2026-11-03T19:00:00Z'), 100.5], // 0.5 kWh in the start hour, day
    [at('2026-11-03T20:00:00Z'), 101.5], // 1 kWh, night
    [at('2026-11-03T21:00:00Z'), 102.5] // 1 kWh, night
  ]
  const energy = meterEnergy(start, first, hourly)
  assert.equal(energy.kwh, 2.5)
  assert.equal(energy.day, 0.5)
  assert.equal(energy.night, 2)
})

test('meterEnergy spreads a gap in the readings over its hours', () => {
  const start = at('2026-11-04T02:00:00Z')
  // no readings in the hours from 03:00 and 04:00 UTC: 3 kWh over three
  // hours, 05:00, 06:00 and 07:00 local; night ends at 06:00
  const energy = meterEnergy(start, 10, [[at('2026-11-04T02:00:00Z'), 10], [at('2026-11-04T05:00:00Z'), 13]])
  assert.equal(energy.kwh, 3)
  assert.equal(energy.night, 1)
  assert.equal(energy.day, 2)
})

test('meterEnergy is null without any meter reading in the charge', () => {
  assert.equal(meterEnergy(at('2026-11-04T02:00:00Z'), undefined, []), null)
})

test('a charge is home when the house meter took 0.5 kWh or more, and it gets a cost by zone', () => {
  const row = chargeRow(session(), { meter: { kwh: 12, day: 2, night: 10 }, carMinKw: 0.4, meterMaxW: 1300 }, config)
  assert.equal(row.place, 'home')
  assert.equal(row.type, 'AC')
  assert.equal(row.month, '2026-11')
  assert.equal(row.meter_kwh, 12)
  assert.equal(row.meter_kwh_day, 2)
  assert.equal(row.meter_kwh_night, 10)
  assert.equal(row.cost_day_eur, 0.4)
  assert.equal(row.cost_night_eur, 1)
  assert.equal(row.cost_eur, 1.4)
  assert.equal(row.battery_kwh, 10)
  assert.equal(row.duration_min, 600)
  // at home the peak is the meter's
  assert.equal(row.power_max_kw, 1.3)
})

test('the peak of a home charge is the meter peak even when the car logged a part of the charge', () => {
  const row = chargeRow(session(), { meter: { kwh: 12, day: 2, night: 10 }, carMinKw: -0.9, meterMaxW: 1300 }, config)
  assert.equal(row.power_max_kw, 1.3)
})

test('a charge is away below 0.5 kWh on the house meter, and has no cost', () => {
  const row = chargeRow(session({ power_avg_kw: 45 }), { meter: { kwh: 0.01, day: 0.01, night: 0 }, carMinKw: -62.5, meterMaxW: 0 }, config)
  assert.equal(row.place, 'away')
  assert.equal(row.type, 'DC')
  assert.equal(row.power_max_kw, 62.5)
  assert.equal(row.meter_kwh, null)
  assert.equal(row.cost_eur, null)
  assert.equal(row.cost_day_eur, null)
})

test('an away charge at up to 8 kW is AC; without any power it is unknown', () => {
  const ac = chargeRow(session({ power_avg_kw: 6.5 }), { meter: { kwh: 0, day: 0, night: 0 }, carMinKw: -7, meterMaxW: 0 }, config)
  assert.equal(ac.type, 'AC')
  const unknown = chargeRow(session({ power_avg_kw: null, duration_is_charge: false }), { meter: { kwh: 0, day: 0, night: 0 }, carMinKw: null, meterMaxW: null }, config)
  assert.equal(unknown.type, 'unknown')
  // the whole rest is not the charge, so there is no duration
  assert.equal(unknown.duration_min, null)
})

test('a charge without any meter reading is neither home nor away', () => {
  const row = chargeRow(session(), { meter: null, carMinKw: null, meterMaxW: null }, config)
  assert.equal(row.place, 'unknown')
  assert.equal(row.cost_eur, null)
})

test('a home charge before the month of the current prices has no cost', () => {
  const row = chargeRow(session({ start: at('2026-06-10T18:00:00Z'), end: at('2026-06-11T04:00:00Z') }), { meter: { kwh: 5, day: 1, night: 4 }, carMinKw: null, meterMaxW: 1200 }, config)
  assert.equal(row.place, 'home')
  assert.equal(row.meter_kwh, 5)
  assert.equal(row.cost_eur, null)
})

test('the month of a charge is the local month of its start', () => {
  // 23:30 UTC on 31 October is 01:30 on 1 November in Sofia
  const row = chargeRow(session({ start: at('2026-10-31T23:30:00Z') }), { meter: null, carMinKw: null, meterMaxW: null }, config)
  assert.equal(row.month, '2026-11')
})

test('toChargeLines writes one point at the start of the charge and leaves out empty fields', () => {
  const row = chargeRow(session({ power_avg_kw: 45 }), { meter: { kwh: 0, day: 0, night: 0 }, carMinKw: -50, meterMaxW: 0 }, config)
  const [line] = toChargeLines([row])
  assert.equal(line, 'ioniq_charges,month=2026-11,place=away,type=DC ' +
    `end_ts=${at('2026-11-04T05:50:00Z')},soc_start=30,soc_end=70,battery_kwh=10,duration_min=600,power_avg_kw=45,power_max_kw=50 ${at('2026-11-03T18:10:00Z')}`)
})

test('chargeSummary has the last 10 charges, newest first, and the totals of this month', () => {
  const rows = []
  // 12 charges a day apart, from 25 October to 5 November; the even ones are home
  for (let i = 0; i < 12; i++) {
    const start = at('2026-10-25T18:00:00Z') + i * 24 * H
    const home = i % 2 === 0
    rows.push(chargeRow(session({ start, end: start + 10 * H }), {
      meter: home ? { kwh: 12, day: 2, night: 10 } : { kwh: 0, day: 0, night: 0 },
      carMinKw: null,
      meterMaxW: home ? 1300 : 0
    }, config))
  }
  const summary = chargeSummary(rows, at('2026-11-05T20:00:00Z'), config.pricesFrom)
  assert.equal(summary.month, '2026-11')
  assert.equal(summary.charges.length, 10)
  assert.equal(summary.charges[0].start, '2026-11-05T18:00:00.000Z')
  assert.equal(summary.charges[9].start, '2026-10-27T18:00:00.000Z')
  assert.deepEqual(Object.keys(summary.charges[0]), [
    'start', 'place', 'type', 'soc_from', 'soc_to', 'kwh', 'meter_kwh', 'min', 'avg_kw', 'max_kw', 'cost', 'cost_day', 'cost_night'
  ])
  // November 1 to 5: five charges, two of them home (2 and 4 November)
  assert.deepEqual(summary.totals, { count: 5, home: 2, kwh: 50, meter_kwh: 24, cost: 2.8, cost_day: 0.8, cost_night: 2 })
  assert.equal(CHARGES_TOPIC, 'homy/ioniq/charges')
})

test('chargeSummary has no cost in a month before the current prices', () => {
  const summary = chargeSummary([], at('2026-06-05T20:00:00Z'), '2026-07')
  assert.deepEqual(summary.totals, { count: 0, home: 0, kwh: 0, meter_kwh: 0, cost: null, cost_day: null, cost_night: null })
  assert.deepEqual(summary.charges, [])
})
