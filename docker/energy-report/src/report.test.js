import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAIN, LOADS, monthReport, toLineProtocol, monthsToCompute, shouldSendOnStart } from './report.js'

const at = (iso) => Date.parse(iso)
const PRICES = { day: 0.15458, night: 0.09226 }

const input = (month, lastYear = {}) => ({
  month,
  main: { kwh: 1000, day: 600, night: 400 },
  loads: {
    charger: { kwh: 300, day: 60, night: 240 },
    boiler: { kwh: 200, day: 100, night: 100 }
  },
  prices: PRICES,
  pricesFrom: '2026-07',
  lastYear
})
const fieldsOf = (rows) => Object.fromEntries(rows.map((r) => [r.meter, r.fields]))

test('monthReport: main, each meter and not_metered, with day + night = total', () => {
  const rows = monthReport(input('2026-08'))
  assert.deepEqual(rows.map((r) => r.meter), ['main', 'charger', 'boiler', 'not_metered'])
  for (const { meter, fields } of rows) {
    assert.ok(Math.abs(fields.kwh_day + fields.kwh_night - fields.kwh) < 1e-9, meter)
  }
})

test('monthReport: not_metered is main minus the sum of the meters', () => {
  const f = fieldsOf(monthReport(input('2026-08')))
  assert.equal(f.not_metered.kwh, 500)
  assert.equal(f.not_metered.kwh_day, 440)
  assert.equal(f.not_metered.kwh_night, 60)
})

test('monthReport: the share of main and the night share', () => {
  const f = fieldsOf(monthReport(input('2026-08')))
  assert.equal(f.main.share_pct, 100)
  assert.equal(f.main.night_share_pct, 40)
  assert.equal(f.charger.share_pct, 30)
  assert.equal(f.charger.night_share_pct, 80)
  assert.equal(f.not_metered.share_pct, 50)
  assert.equal(f.not_metered.night_share_pct, 12)
})

test('monthReport: cost = day kWh x day price + night kWh x night price', () => {
  const f = fieldsOf(monthReport(input('2026-08')))
  assert.equal(f.main.cost_eur, 129.652)
  assert.equal(f.charger.cost_eur, 31.417)
  assert.equal(f.boiler.cost_eur, 24.684)
  assert.equal(f.not_metered.cost_eur, 73.551)
})

test('monthReport: cost only from the first month of the prices', () => {
  assert.equal(fieldsOf(monthReport(input('2026-07'))).main.cost_eur, 129.652)
  for (const { fields } of monthReport(input('2026-06'))) assert.equal('cost_eur' in fields, false)
})

test('monthReport: the same month of last year, when it exists', () => {
  const f = fieldsOf(monthReport(input('2026-08', { main: 800, charger: 0 })))
  assert.equal(f.main.kwh_last_year, 800)
  assert.equal(f.main.change_pct, 25)
  // no change against 0 kWh
  assert.equal(f.charger.kwh_last_year, 0)
  assert.equal('change_pct' in f.charger, false)
  // no row last year
  assert.equal('kwh_last_year' in f.boiler, false)
  assert.equal('change_pct' in f.boiler, false)
})

test('monthReport: no last-year fields when last year is not stored', () => {
  for (const { fields } of monthReport(input('2026-08'))) {
    assert.equal('kwh_last_year' in fields, false)
    assert.equal('change_pct' in fields, false)
  }
})

test('monthReport: no shares when the main meter counted nothing', () => {
  const rows = monthReport({ ...input('2026-08'), main: { kwh: 0, day: 0, night: 0 }, loads: {} })
  assert.deepEqual(rows.map((r) => r.fields), [
    { kwh: 0, kwh_day: 0, kwh_night: 0, cost_eur: 0 },
    { kwh: 0, kwh_day: 0, kwh_night: 0, cost_eur: 0 }
  ])
})

test('toLineProtocol: one point per meter, tagged with the meter and the month', () => {
  const rows = [{ meter: 'main', fields: { kwh: 1322.3, kwh_day: 681.1, kwh_night: 641.2, share_pct: 100 } }]
  assert.deepEqual(toLineProtocol('2025-11', rows, at('2025-10-31T22:00:00Z')), [
    'energy_monthly,meter=main,month=2025-11 kwh=1322.3,kwh_day=681.1,kwh_night=641.2,share_pct=100 1761948000000'
  ])
})

test('monthsToCompute: the months not stored yet, oldest first', () => {
  const stored = new Set(['2023-11', '2024-01'])
  assert.deepEqual(monthsToCompute({ stored, first: '2023-11', last: '2024-03' }), ['2023-12', '2024-02', '2024-03'])
  assert.deepEqual(monthsToCompute({ stored: new Set(['2023-11']), first: '2023-11', last: '2023-11' }), [])
})

test('shouldSendOnStart: only when the previous month was computed now, on the 1st to 3rd', () => {
  // 2026-11-01 00:40 local
  assert.equal(shouldSendOnStart(at('2026-10-31T22:40:00Z'), ['2026-10']), true)
  // 2026-11-03 23:00 local
  assert.equal(shouldSendOnStart(at('2026-11-03T21:00:00Z'), ['2026-09', '2026-10']), true)
  // 2026-11-04 08:00 local
  assert.equal(shouldSendOnStart(at('2026-11-04T06:00:00Z'), ['2026-10']), false)
  // a deploy on the 21st
  assert.equal(shouldSendOnStart(at('2026-10-21T08:00:00Z'), ['2026-09']), false)
  // a restart on the 1st, with October already stored
  assert.equal(shouldSendOnStart(at('2026-10-31T22:40:00Z'), []), false)
  assert.equal(shouldSendOnStart(at('2026-10-31T22:40:00Z'), ['2026-08']), false)
})

test('the meters are the physical meters of the backfill that count from 2023-11', () => {
  const backfill = readFileSync(new URL('../../../scripts/energy-backfill/index.mjs', import.meta.url), 'utf8')
  for (const m of [MAIN, ...LOADS]) {
    const call = m.measurement === 'power_meter' && m.bus === 'secondary' && m.field === 'total'
      ? `secondary('${m.device}', '${m.type}')`
      : `meter('${m.measurement}', '${m.bus}', '${m.device}', '${m.type}', '${m.field}')`
    assert.ok(backfill.includes(call), `${m.name}: ${call} is not in the backfill`)
  }
  const names = LOADS.map((m) => m.name)
  assert.equal(new Set(names).size, names.length)
  for (const left of ['kitchen', 'waste_pump']) assert.equal(names.includes(left), false)
})
