import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMonth, catchUp, runScheduled, runForever } from './run.js'
import { monthsBetween } from './time.js'

const H = 3600 * 1000
const DAY = 24 * H
const at = (iso) => Date.parse(iso)

// kWh per hour of each meter in the fake InfluxDB
const RATE = { main: 2, water_pump: 0.1, oven: 0.05, stove: 0.05, dishwasher: 0.05, laundry: 0.02, boiler: 0.3, heat_pump: 0.4, microwave: 0.01, charger: 0.5 }

// A fake InfluxDB: each meter counts at its RATE, one reading per hour, and
// energy_monthly keeps what was written.
function fakeInflux ({ stored = [], fail = 0 } = {}) {
  const months = new Map(stored.map((m) => [m, {}]))
  const queries = []
  const written = []
  let failures = fail
  return {
    queries,
    written,
    months,
    async query (q) {
      queries.push(q)
      if (failures > 0) { failures--; throw new Error('InfluxDB query: HTTP 503') }
      if (q.startsWith('SHOW TAG VALUES')) {
        return months.size ? [{ values: [...months.keys()].sort().map((m) => ['month', m]) }] : []
      }
      const lastYear = q.match(/FROM "energy_monthly" WHERE "month" = '([\d-]+)'/)
      if (lastYear) {
        const kwh = months.get(lastYear[1]) ?? {}
        return Object.entries(kwh).map(([meter, value]) => ({ tags: { meter }, values: [[0, value]] }))
      }
      const device = q.match(/"device.name" = '([a-z_]+)'/)[1]
      const [, from, to] = q.match(/time >= (\d+)ms AND time < (\d+)ms/).map(Number)
      const values = []
      for (let h = from; h < to; h += H) values.push([h, 1000 + RATE[device] * (h - from) / H])
      return [{ values }]
    },
    async write (lines) {
      written.push(...lines)
      for (const line of lines) {
        const [, meter, month, kwh] = line.match(/^energy_monthly,meter=(\w+),month=([\d-]+) kwh=([\d.-]+)/)
        if (!months.has(month)) months.set(month, {})
        months.get(month)[meter] = Number(kwh)
      }
    }
  }
}

function fakeDeps ({ now, influx = fakeInflux() }) {
  const deps = {
    clock: at(now),
    sleeps: [],
    sent: [],
    logged: [],
    influx,
    config: { firstMonth: '2023-11', pricesFrom: '2026-07', prices: { day: 0.2, night: 0.1 }, dashboardUrl: 'http://grafana/d/energy-monthly' },
    now: () => deps.clock,
    sleep: async (ms) => { deps.sleeps.push(ms); deps.clock += ms },
    send: async (text) => { deps.sent.push(text) },
    log: (message) => { deps.logged.push(message) }
  }
  return deps
}

const writtenMonths = (influx) => [...new Set(influx.written.map((l) => l.match(/month=([\d-]+)/)[1]))]

test('computeMonth reads each meter around the month and writes one point per meter', async () => {
  const deps = fakeDeps({ now: '2026-10-21T08:00:00Z' })
  const rows = await computeMonth(deps, '2025-11')
  assert.deepEqual(rows.map((r) => r.meter), ['main', ...Object.keys(RATE).slice(1), 'not_metered'])
  const lines = deps.influx.written
  assert.equal(lines.length, 11)
  // stamped with the time of the write, so it goes into the current shard;
  // the month is only in the tag
  for (const line of lines) assert.match(line, new RegExp(`^energy_monthly,meter=\\w+,month=2025-11 .* ${at('2026-10-21T08:00:00Z')}$`))
  // 720 hours, 240 of them at night
  const main = rows[0].fields
  assert.deepEqual([main.kwh, main.kwh_day, main.kwh_night, main.night_share_pct], [1440, 960, 480, 33.333])
  assert.equal('cost_eur' in main, false)
  const notMetered = rows.at(-1).fields
  assert.equal(notMetered.kwh, 374.4)
  // a week before and after the month, so that gaps across its edges are spread
  const hourly = deps.influx.queries.filter((q) => q.startsWith('SELECT last("total")') || q.startsWith('SELECT last("tot_act")'))
  assert.equal(hourly.length, 10)
  for (const q of hourly) assert.match(q, new RegExp(`time >= ${at('2025-10-24T22:00:00Z')}ms AND time < ${at('2025-12-07T22:00:00Z')}ms`))
  // the charger is read from its own measurement
  assert.ok(hourly.some((q) => q.includes('FROM "xymd1"') && q.includes("'charger'")))
})

test('computeMonth adds last year and the cost from the first month of the prices', async () => {
  const influx = fakeInflux()
  influx.months.set('2025-08', { main: 1000, charger: 300 })
  const deps = fakeDeps({ now: '2026-10-21T08:00:00Z', influx })
  const main = (await computeMonth(deps, '2026-08'))[0].fields
  // 744 hours, 248 of them at night
  assert.equal(main.kwh, 1488)
  assert.equal(main.kwh_last_year, 1000)
  assert.equal(main.change_pct, 48.8)
  assert.equal(main.cost_eur, 248)
})

test('catchUp after a deploy on the 21st computes the missing months, oldest first, and sends nothing', async () => {
  const stored = monthsBetween('2023-11', '2026-07').filter((m) => m !== '2024-05')
  const deps = fakeDeps({ now: '2026-10-21T08:00:00Z', influx: fakeInflux({ stored }) })
  const { computed } = await catchUp(deps)
  assert.deepEqual(computed, ['2024-05', '2026-08', '2026-09'])
  assert.deepEqual(writtenMonths(deps.influx), computed)
  assert.deepEqual(deps.sent, [])
})

test('catchUp on the first start computes every month from 2023-11', async () => {
  const deps = fakeDeps({ now: '2026-10-21T08:00:00Z' })
  const { computed } = await catchUp(deps)
  assert.deepEqual(computed, monthsBetween('2023-11', '2026-09'))
})

test('catchUp on the 1st sends the report of the previous month when it was missing', async () => {
  // 2026-11-01 00:40 local
  const deps = fakeDeps({ now: '2026-10-31T22:40:00Z', influx: fakeInflux({ stored: monthsBetween('2023-11', '2026-09') }) })
  const { computed } = await catchUp(deps)
  assert.deepEqual(computed, ['2026-10'])
  assert.equal(deps.sent.length, 1)
  assert.match(deps.sent[0], /^<b>Energy 2026-10<\/b>/)
})

test('catchUp after a restart on the 1st sends nothing when the month is already stored', async () => {
  const deps = fakeDeps({ now: '2026-10-31T22:40:00Z', influx: fakeInflux({ stored: monthsBetween('2023-11', '2026-10') }) })
  const { computed } = await catchUp(deps)
  assert.deepEqual(computed, [])
  assert.deepEqual(deps.influx.written, [])
  assert.deepEqual(deps.sent, [])
})

test('catchUp before 00:30 on the 1st leaves the previous month to the run at 00:30', async () => {
  // 2026-11-01 00:10 local
  const deps = fakeDeps({ now: '2026-10-31T22:10:00Z', influx: fakeInflux({ stored: monthsBetween('2023-11', '2026-08') }) })
  const { computed } = await catchUp(deps)
  assert.deepEqual(computed, ['2026-09'])
  assert.deepEqual(deps.sent, [])
})

test('runScheduled sleeps until 00:30 local on the 1st, in steps of at most a day, then reports the month', async () => {
  const deps = fakeDeps({ now: '2026-10-21T08:00:00Z', influx: fakeInflux({ stored: monthsBetween('2023-11', '2026-09') }) })
  const ran = await runScheduled(deps, deps.now())
  assert.equal(new Date(ran).toISOString(), '2026-10-31T22:30:00.000Z')
  assert.equal(deps.clock, ran)
  assert.ok(deps.sleeps.every((ms) => ms > 0 && ms <= DAY))
  assert.deepEqual(writtenMonths(deps.influx), ['2026-10'])
  assert.equal(deps.sent.length, 1)
  assert.match(deps.sent[0], /^<b>Energy 2026-10<\/b>/)
})

test('runScheduled runs at once when a long catch-up went past 00:30', async () => {
  // the catch-up started at 00:25 local and ended at 00:32
  const deps = fakeDeps({ now: '2026-10-31T22:32:00Z' })
  const ran = await runScheduled(deps, at('2026-10-31T22:25:00Z'))
  assert.equal(new Date(ran).toISOString(), '2026-10-31T22:30:00.000Z')
  assert.deepEqual(deps.sleeps, [])
  assert.deepEqual(writtenMonths(deps.influx), ['2026-10'])
  assert.equal(deps.sent.length, 1)
})

test('runScheduled tries again after 15 minutes when InfluxDB fails, and sends once', async () => {
  const deps = fakeDeps({ now: '2026-10-31T22:30:00Z', influx: fakeInflux({ fail: 2 }) })
  await runScheduled(deps, at('2026-10-31T22:29:00Z'))
  assert.deepEqual(deps.sleeps, [15 * 60 * 1000, 15 * 60 * 1000])
  assert.equal(deps.logged.filter((m) => /HTTP 503/.test(m)).length, 2)
  assert.deepEqual(writtenMonths(deps.influx), ['2026-10'])
  assert.equal(deps.sent.length, 1)
})

test('runForever catches up first, then runs each month', async () => {
  const deps = fakeDeps({ now: '2026-10-21T08:00:00Z', influx: fakeInflux({ stored: monthsBetween('2023-11', '2026-08'), fail: 1 }) })
  await runForever(deps, 2)
  assert.deepEqual(writtenMonths(deps.influx), ['2026-09', '2026-10', '2026-11'])
  assert.equal(deps.sent.length, 2)
  assert.match(deps.sent[0], /Energy 2026-10/)
  assert.match(deps.sent[1], /Energy 2026-11/)
})
