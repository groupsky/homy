import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInflux, storedMonths, hourlyReadings, lastYearKwh, chargeSessions, storedCharges, chargerStart, carMinKw } from './influx.js'

const options = {
  url: 'http://influxdb:8086',
  database: 'homy',
  read: { username: 'reader', password: 'r' },
  write: { username: 'writer', password: 'w' }
}
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

// A fetch that records each call and answers with the given bodies in turn.
function fakeFetch (...answers) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: new URL(url), init })
    const answer = answers.shift() ?? { results: [{}] }
    if (answer instanceof Error) throw answer
    const { status = 200, body = answer } = answer.status ? answer : {}
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return { fetch, calls }
}

test('query reads with the read user and gives the series', async () => {
  const series = [{ name: 'x', columns: ['time', 'last'], values: [[0, 1]] }]
  const { fetch, calls } = fakeFetch({ results: [{ series }] })
  const influx = createInflux(options, fetch)
  assert.deepEqual(await influx.query('SELECT 1'), series)
  const { url, init } = calls[0]
  assert.equal(url.origin + url.pathname, 'http://influxdb:8086/query')
  assert.equal(url.searchParams.get('db'), 'homy')
  assert.equal(url.searchParams.get('q'), 'SELECT 1')
  assert.equal(url.searchParams.get('epoch'), 'ms')
  assert.equal(init.headers.Authorization, basic('reader', 'r'))
  // the password is never in the URL
  assert.equal(url.searchParams.has('p'), false)
})

test('query gives no series for an empty result', async () => {
  const { fetch } = fakeFetch({ results: [{ statement_id: 0 }] })
  assert.deepEqual(await createInflux(options, fetch).query('SELECT 1'), [])
})

test('query fails on an HTTP error and on an error in the result', async () => {
  const influx = createInflux(options, fakeFetch({ status: 401, body: { error: 'authorization failed' } }, { results: [{ error: 'bad query' }] }).fetch)
  await assert.rejects(influx.query('SELECT 1'), /HTTP 401/)
  await assert.rejects(influx.query('SELECT 1'), /bad query/)
})

test('write posts line protocol with the write user, in milliseconds', async () => {
  const { fetch, calls } = fakeFetch({ status: 204, body: {} })
  await createInflux(options, fetch).write(['a x=1 1', 'a x=2 2'])
  const { url, init } = calls[0]
  assert.equal(url.origin + url.pathname, 'http://influxdb:8086/write')
  assert.equal(url.searchParams.get('db'), 'homy')
  assert.equal(url.searchParams.get('precision'), 'ms')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, basic('writer', 'w'))
  assert.equal(init.body, 'a x=1 1\na x=2 2')
})

test('write fails on an HTTP error', async () => {
  const { fetch } = fakeFetch({ status: 403, body: { error: 'not authorized' } })
  await assert.rejects(createInflux(options, fetch).write(['a x=1 1']), /HTTP 403/)
})

test('storedMonths lists the months in energy_monthly', async () => {
  const { fetch, calls } = fakeFetch({ results: [{ series: [{ name: 'energy_monthly', columns: ['key', 'value'], values: [['month', '2023-11'], ['month', '2023-12']] }] }] })
  assert.deepEqual(await storedMonths(createInflux(options, fetch)), ['2023-11', '2023-12'])
  assert.equal(calls[0].url.searchParams.get('q'), 'SHOW TAG VALUES FROM "energy_monthly" WITH KEY = "month"')
})

test('storedMonths is empty before the first report', async () => {
  const { fetch } = fakeFetch({ results: [{ statement_id: 0 }] })
  assert.deepEqual(await storedMonths(createInflux(options, fetch)), [])
})

test('hourlyReadings asks for the last reading of each hour of one meter, like the backfill', async () => {
  const { fetch, calls } = fakeFetch({ results: [{ series: [{ columns: ['time', 'last'], values: [[3600000, 10.5], [7200000, 11]] }] }] })
  const meter = { name: 'boiler', measurement: 'power_meter', bus: 'secondary', device: 'boiler', type: 'dds519mr', field: 'total' }
  assert.deepEqual(await hourlyReadings(createInflux(options, fetch), meter, 1000, 2000), [[3600000, 10.5], [7200000, 11]])
  assert.equal(calls[0].url.searchParams.get('q'),
    'SELECT last("total") FROM "power_meter" WHERE "bus" = \'secondary\' AND "device.name" = \'boiler\' ' +
    'AND "device.type" = \'dds519mr\' AND "total" > 0 AND time >= 1000ms AND time < 2000ms GROUP BY time(1h) fill(none)')
})

test('lastYearKwh gives the kWh of the newest point of each meter in a month', async () => {
  const { fetch, calls } = fakeFetch({
    results: [{
      series: [
        { name: 'energy_monthly', tags: { meter: 'main' }, columns: ['time', 'kwh'], values: [[0, 1257.1]] },
        { name: 'energy_monthly', tags: { meter: 'charger' }, columns: ['time', 'kwh'], values: [[0, 0]] }
      ]
    }]
  })
  assert.deepEqual(await lastYearKwh(createInflux(options, fetch), '2024-11'), { main: 1257.1, charger: 0 })
  assert.equal(calls[0].url.searchParams.get('q'), 'SELECT "kwh" FROM "energy_monthly" WHERE "month" = \'2024-11\' GROUP BY "meter" ORDER BY time DESC LIMIT 1')
})

test('chargeSessions reads the charges of ioniq_sessions as rows', async () => {
  const series = [{
    name: 'ioniq_sessions',
    columns: ['time', 'end_ts', 'duration_sec', 'duration_is_charge', 'energy_in_kwh', 'soc_start', 'soc_end', 'power_avg_kw'],
    values: [[1000, 9000, 8, true, 5, 40, 60, 2.25], [20000, 30000, 10, false, 1, 50, 52, null]]
  }]
  const { fetch, calls } = fakeFetch({ results: [{ series }] })
  const sessions = await chargeSessions(createInflux(options, fetch))
  assert.match(calls[0].url.searchParams.get('q'), /FROM "ioniq_sessions" WHERE "kind" = 'charge'$/)
  assert.deepEqual(sessions[0], { start: 1000, end: 9000, duration_sec: 8, duration_is_charge: true, energy_in_kwh: 5, soc_start: 40, soc_end: 60, power_avg_kw: 2.25 })
  assert.equal(sessions[1].power_avg_kw, null)
})

test('storedCharges gives the stored charges by their start', async () => {
  const series = [{
    name: 'ioniq_charges',
    columns: ['time', 'battery_kwh', 'cost_eur', 'end_ts', 'month', 'place', 'type'],
    values: [[1000, 5, 1.5, 9000, '2026-11', 'home', 'AC']]
  }]
  const { fetch, calls } = fakeFetch({ results: [{ series }] })
  const stored = await storedCharges(createInflux(options, fetch))
  assert.equal(calls[0].url.searchParams.get('q'), 'SELECT * FROM "ioniq_charges"')
  const row = stored.get(1000)
  assert.equal(row.place, 'home')
  assert.equal(row.end, 9000)
  assert.equal(row.cost_eur, 1.5)
  assert.equal(row.meter_kwh, null)
})

test('chargerStart and carMinKw read the meter and the car within the charge', async () => {
  const { fetch, calls } = fakeFetch(
    { results: [{ series: [{ columns: ['time', 'first', 'max'], values: [[0, 7000.5, 1250]] }] }] },
    { results: [{}] },
    { results: [{ series: [{ columns: ['time', 'min'], values: [[0, -45.5]] }] }] }
  )
  const influx = createInflux(options, fetch)
  assert.deepEqual(await chargerStart(influx, 1000, 9000), { first: 7000.5, maxW: 1250 })
  assert.deepEqual(await chargerStart(influx, 1000, 9000), { first: undefined, maxW: undefined })
  assert.equal(await carMinKw(influx, 1000, 9000), -45.5)
  const [meter, , car] = calls.map((c) => c.url.searchParams.get('q'))
  assert.equal(meter, 'SELECT first("tot_act"), max("ap") FROM "xymd1" WHERE "bus" = \'monitoring\' AND "device.name" = \'charger\' ' +
    'AND "device.type" = \'or-we-526\' AND "tot_act" > 0 AND time >= 1000ms AND time <= 9000ms')
  assert.equal(car, 'SELECT min("hv_kw") FROM "ioniq" WHERE "group" = \'bms/2101\' AND time >= 1000ms AND time <= 9000ms')
})
