import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshCharges, runCharges } from './run.js'

const H = 3600 * 1000
const at = (iso) => Date.parse(iso)

// Two made-up charges: a home one overnight, where the charger meter counts
// 1 kWh an hour, and an away one, where it counts nothing.
const HOME = { start: at('2026-11-03T20:00:00Z'), end: at('2026-11-04T02:00:00Z') }
const AWAY = { start: at('2026-11-05T10:00:00Z'), end: at('2026-11-05T10:30:00Z') }

function fakeInflux ({ stored = [], fail = 0 } = {}) {
  const queries = []
  const written = []
  let failures = fail
  const session = ({ start, end }, avg) => [start, end, (end - start) / 1000, true, 9, 30, 70, avg]
  return {
    queries,
    written,
    async query (q) {
      queries.push(q)
      if (failures > 0) { failures--; throw new Error('InfluxDB query: HTTP 503') }
      if (q.startsWith('SELECT * FROM "ioniq_charges"')) {
        return stored.length ? [{ columns: ['time', 'end_ts', 'month', 'place', 'type', 'battery_kwh'], values: stored }] : []
      }
      if (q.includes('FROM "ioniq_sessions"')) {
        return [{ columns: ['time', 'end_ts', 'duration_sec', 'duration_is_charge', 'energy_in_kwh', 'soc_start', 'soc_end', 'power_avg_kw'], values: [session(HOME, 1.5), session(AWAY, 40)] }]
      }
      const [, from, to] = q.match(/time >= (\d+)ms AND time <= (\d+)ms/) ?? q.match(/time >= (\d+)ms AND time < (\d+)ms/)
      const home = Number(from) === HOME.start
      if (q.includes('first("tot_act")')) return [{ columns: ['time', 'first', 'max'], values: [[0, 500, home ? 1500 : 0]] }]
      if (q.includes('min("hv_kw")')) return home ? [] : [{ columns: ['time', 'min'], values: [[0, -48]] }]
      // the last counter reading of each hour
      const values = []
      for (let h = Math.floor(Number(from) / H) * H; h < Number(to); h += H) values.push([h, home ? 500 + (h - Number(from)) / H + 1 : 500])
      return [{ values }]
    },
    async write (lines) { written.push(...lines) }
  }
}

function fakeDeps ({ now = '2026-11-06T08:00:00Z', influx = fakeInflux() } = {}) {
  const deps = {
    clock: at(now),
    sleeps: [],
    published: [],
    logged: [],
    influx,
    config: { pricesFrom: '2026-07', prices: { day: 0.2, night: 0.1 } },
    now: () => deps.clock,
    sleep: async (ms) => { deps.sleeps.push(ms); deps.clock += ms },
    publish: async (topic, payload) => { deps.published.push({ topic, payload: JSON.parse(payload) }) },
    log: (message) => { deps.logged.push(message) }
  }
  return deps
}

test('refreshCharges computes the new charges, writes each one and publishes the summary', async () => {
  const deps = fakeDeps()
  const known = new Map()
  await refreshCharges(deps, known)
  assert.equal(deps.influx.written.length, 2)
  // 1 kWh in each hour from 22:00 to 04:00 local (the hour of the end
  // too), all night
  assert.equal(deps.influx.written[0], 'ioniq_charges,month=2026-11,place=home,type=AC ' +
    `end_ts=${HOME.end},soc_start=30,soc_end=70,battery_kwh=9,meter_kwh=7,meter_kwh_day=0,meter_kwh_night=7,` +
    `cost_eur=0.7,cost_day_eur=0,cost_night_eur=0.7,duration_min=360,power_avg_kw=1.5,power_max_kw=1.5 ${HOME.start}`)
  assert.match(deps.influx.written[1], /^ioniq_charges,month=2026-11,place=away,type=DC .*power_max_kw=48 /)
  const [{ topic, payload }] = deps.published
  assert.equal(topic, 'homy/ioniq/charges')
  assert.equal(payload.charges.length, 2)
  assert.equal(payload.charges[0].place, 'away')
  assert.deepEqual(payload.totals, { count: 2, home: 1, kwh: 18, meter_kwh: 7, cost: 0.7, cost_day: 0, cost_night: 0.7 })

  // the next refresh reads only the sessions, and computes nothing again
  const before = deps.influx.queries.length
  await refreshCharges(deps, known)
  assert.equal(deps.influx.queries.length, before + 1)
  assert.equal(deps.influx.written.length, 2)
  assert.equal(deps.published.length, 2)
})

test('runCharges loads the stored charges once, then refreshes every 15 minutes', async () => {
  const influx = fakeInflux({ stored: [[HOME.start, HOME.end, '2026-11', 'home', 'AC', 9]] })
  const deps = fakeDeps({ influx })
  await runCharges(deps, 3)
  assert.deepEqual(deps.sleeps, [15 * 60 * 1000, 15 * 60 * 1000, 15 * 60 * 1000])
  assert.equal(influx.queries.filter((q) => q.startsWith('SELECT * FROM "ioniq_charges"')).length, 1)
  // only the away charge was missing
  assert.equal(influx.written.length, 1)
  assert.match(influx.written[0], /place=away/)
  assert.equal(deps.published.length, 3)
})

test('runCharges logs a failure and tries again at the next refresh', async () => {
  const deps = fakeDeps({ influx: fakeInflux({ fail: 1 }) })
  await runCharges(deps, 2)
  assert.match(deps.logged[0], /charges failed: InfluxDB query: HTTP 503; trying again in 15 minutes/)
  assert.equal(deps.influx.written.length, 2)
  assert.equal(deps.published.length, 1)
})

test('runCharges logs a failed publish and goes on', async () => {
  const deps = fakeDeps()
  deps.publish = async () => { throw new Error('MQTT publish to broker:1883 timed out') }
  await runCharges(deps, 2)
  assert.equal(deps.logged.filter((m) => /timed out/.test(m)).length, 2)
  // the charges are written once, even though the publish failed
  assert.equal(deps.influx.written.length, 2)
})

test('refreshCharges logs a charge that fails, goes on with the others and still publishes', async () => {
  const influx = fakeInflux()
  const query = influx.query
  influx.query = async (q) => {
    if (q.includes('min("hv_kw")') && q.includes(`time >= ${HOME.start}ms`)) throw new Error('InfluxDB query: timeout')
    return query(q)
  }
  const deps = fakeDeps({ influx })
  const known = new Map()
  await refreshCharges(deps, known)
  assert.equal(influx.written.length, 1)
  assert.match(influx.written[0], /place=away/)
  assert.match(deps.logged[0], /^charge at \d+ failed: InfluxDB query: timeout/)
  assert.equal(deps.published.length, 1)
  // the next refresh tries the failed charge again
  assert.equal(known.has(HOME.start), false)
})
