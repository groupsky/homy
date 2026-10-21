import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadConfig, gridPrices } from './config.js'

// The real file, as Home Assistant reads it. Its prices change every July, so
// the tests below use their own prices.
const REAL_ENERGY_JSON = readFileSync(new URL('../../../config/home-assistant/energy.json', import.meta.url), 'utf8')
const grid = (statistic, price) => ({ type: 'grid', stat_energy_from: statistic, number_energy_price: price })
const ENERGY_JSON = JSON.stringify({
  data: {
    energy_sources: [grid('sensor.grid_import_day', 0.2), grid('sensor.grid_import_night', 0.1)],
    device_consumption: []
  }
})

const files = {
  '/run/secrets/read_user': 'reader\n',
  '/run/secrets/read_password': 'read-secret\n',
  '/run/secrets/write_user': 'writer\n',
  '/run/secrets/write_password': 'write-secret\n',
  '/config/energy.json': ENERGY_JSON
}
const readFile = (path) => {
  if (!(path in files)) throw new Error(`ENOENT: ${path}`)
  return files[path]
}
const env = {
  INFLUXDB_READ_USERNAME_FILE: '/run/secrets/read_user',
  INFLUXDB_READ_PASSWORD_FILE: '/run/secrets/read_password',
  INFLUXDB_USERNAME_FILE: '/run/secrets/write_user',
  INFLUXDB_PASSWORD_FILE: '/run/secrets/write_password'
}

test('loadConfig reads the secrets and uses the defaults', () => {
  assert.deepEqual(loadConfig(env, readFile), {
    influx: {
      url: 'http://influxdb:8086',
      database: 'homy',
      read: { username: 'reader', password: 'read-secret' },
      write: { username: 'writer', password: 'write-secret' }
    },
    telegramUrl: 'http://telegram-bridge:3000/webhook',
    dashboardUrl: undefined,
    firstMonth: '2023-11',
    pricesFrom: '2026-07',
    prices: { day: 0.2, night: 0.1 }
  })
})

test('loadConfig takes the settings from the environment', () => {
  const config = loadConfig({
    ...env,
    ENERGY_REPORT_DASHBOARD_URL: 'http://grafana/d/other',
    ENERGY_REPORT_FIRST_MONTH: '2024-01',
    ENERGY_REPORT_PRICES_FROM: '2027-07',
    ENERGY_REPORT_PRICES_FILE: '/other/energy.json'
  }, (path) => (path === '/other/energy.json' ? ENERGY_JSON : readFile(path)))
  assert.equal(config.dashboardUrl, 'http://grafana/d/other')
  assert.equal(config.firstMonth, '2024-01')
  assert.equal(config.pricesFrom, '2027-07')
})

test('loadConfig never takes an InfluxDB or telegram-bridge address from the environment', () => {
  // Fixed on purpose: a request URL from the environment is a request-forgery
  // path for CodeQL, and the service only ever talks to these two containers.
  const config = loadConfig({
    ...env,
    INFLUXDB_URL: 'http://elsewhere:8086',
    INFLUXDB_DATABASE: 'other',
    TELEGRAM_BRIDGE_URL: 'http://elsewhere/webhook'
  }, readFile)
  assert.equal(config.influx.url, 'http://influxdb:8086')
  assert.equal(config.influx.database, 'homy')
  assert.equal(config.telegramUrl, 'http://telegram-bridge:3000/webhook')
})

test('loadConfig treats an empty setting as not set', () => {
  const config = loadConfig({ ...env, ENERGY_REPORT_PRICES_FROM: '', ENERGY_REPORT_DASHBOARD_URL: '' }, readFile)
  assert.equal(config.pricesFrom, '2026-07')
  assert.equal(config.dashboardUrl, undefined)
})

test('loadConfig accepts the credentials directly', () => {
  const direct = { INFLUXDB_READ_USERNAME: 'r', INFLUXDB_READ_PASSWORD: 'rp', INFLUXDB_USERNAME: 'w', INFLUXDB_PASSWORD: 'wp' }
  const config = loadConfig(direct, readFile)
  assert.deepEqual(config.influx.read, { username: 'r', password: 'rp' })
  assert.deepEqual(config.influx.write, { username: 'w', password: 'wp' })
})

test('loadConfig needs both users', () => {
  const without = (name) => Object.fromEntries(Object.entries(env).filter(([k]) => k !== name))
  assert.throws(() => loadConfig(without('INFLUXDB_READ_PASSWORD_FILE'), readFile), /INFLUXDB_READ_PASSWORD/)
  assert.throws(() => loadConfig(without('INFLUXDB_USERNAME_FILE'), readFile), /INFLUXDB_USERNAME/)
})

test('loadConfig rejects a month that is not YYYY-MM, and a start before 2023-11', () => {
  assert.throws(() => loadConfig({ ...env, ENERGY_REPORT_PRICES_FROM: '2026-7' }, readFile), /ENERGY_REPORT_PRICES_FROM/)
  assert.throws(() => loadConfig({ ...env, ENERGY_REPORT_FIRST_MONTH: '2023-10' }, readFile), /2023-11/)
})

test('loadConfig rejects a dashboard link that is not a URL, at start', () => {
  assert.throws(() => loadConfig({ ...env, ENERGY_REPORT_DASHBOARD_URL: 'grafana/d/energy-monthly' }, readFile), /ENERGY_REPORT_DASHBOARD_URL/)
  assert.throws(() => loadConfig({ ...env, ENERGY_REPORT_DASHBOARD_URL: 'grafana:3000/d/energy-monthly' }, readFile), /ENERGY_REPORT_DASHBOARD_URL/)
  assert.equal(loadConfig({ ...env, ENERGY_REPORT_DASHBOARD_URL: 'https://grafana/d/x' }, readFile).dashboardUrl, 'https://grafana/d/x')
})

test('gridPrices takes the day and night price of the two grid sources', () => {
  assert.deepEqual(gridPrices(JSON.parse(ENERGY_JSON)), { day: 0.2, night: 0.1 })
})

test('gridPrices reads the real energy.json', () => {
  const { day, night } = gridPrices(JSON.parse(REAL_ENERGY_JSON))
  assert.ok(day > night && night > 0, `day ${day}, night ${night}`)
})

test('gridPrices fails when a grid source has no fixed price', () => {
  const config = JSON.parse(ENERGY_JSON)
  config.data.energy_sources[1].number_energy_price = null
  assert.throws(() => gridPrices(config), /sensor\.grid_import_night/)
})
