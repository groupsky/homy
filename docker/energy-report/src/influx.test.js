import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInflux, storedMonths, hourlyReadings, lastYearKwh } from './influx.js'

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
