// The settings of the service, from the environment and Docker secrets.
import { readFileSync } from 'node:fs'
import { isMonth } from './time.js'

// The first month of the report. The main meter was swapped on 2023-10-15/16,
// and the meters in report.js are the ones that count from then on.
export const FIRST_MONTH = '2023-11'

const GRID_TARIFFS = { day: 'sensor.grid_import_day', night: 'sensor.grid_import_night' }

// An empty value counts as not set: compose passes `${NAME:-}` for optional settings.
const setting = (env, name, fallback) => env[name] || fallback

// NAME_FILE (a Docker secret) or else NAME.
function secret (env, readFile, name) {
  const file = env[`${name}_FILE`]
  const value = file ? readFile(file, 'utf8').trim() : env[name]
  if (!value) throw new Error(`${name}_FILE or ${name} is required`)
  return value
}

// The dashboard link is checked at start, so a bad one cannot fail the
// message after a month is already written.
function url (env, name, fallback) {
  const value = setting(env, name, fallback)
  let protocol
  try {
    protocol = new URL(value).protocol
  } catch {}
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`${name} must be a full http or https URL like ${fallback}, not "${value}"`)
  }
  return value
}

function month (env, name, fallback) {
  const value = setting(env, name, fallback)
  if (!isMonth(value)) throw new Error(`${name} must be a month in the form YYYY-MM, not "${value}"`)
  return value
}

// The day and night prices, in EUR per kWh, of the two grid sources of the
// Home Assistant energy dashboard. The same file sets the prices there.
export function gridPrices (energyConfig) {
  const grid = (energyConfig.data?.energy_sources ?? []).filter((s) => s.type === 'grid')
  const price = (statisticId) => {
    const source = grid.find((s) => s.stat_energy_from === statisticId)
    if (typeof source?.number_energy_price !== 'number') {
      throw new Error(`energy.json has no grid source ${statisticId} with a fixed price`)
    }
    return source.number_energy_price
  }
  return { day: price(GRID_TARIFFS.day), night: price(GRID_TARIFFS.night) }
}

// Fixed on purpose, not configurable, as in scripts/energy-backfill: the
// service talks only to these two containers on the automation network, and a
// request URL taken from the environment would be a request-forgery path.
const INFLUX_URL = 'http://influxdb:8086'
const INFLUX_DB = 'homy'
const TELEGRAM_URL = 'http://telegram-bridge:3000/webhook'

export function loadConfig (env = process.env, readFile = readFileSync) {
  const firstMonth = month(env, 'ENERGY_REPORT_FIRST_MONTH', FIRST_MONTH)
  if (firstMonth < FIRST_MONTH) {
    throw new Error(`ENERGY_REPORT_FIRST_MONTH cannot be before ${FIRST_MONTH}: the main meter was swapped in 2023-10`)
  }
  const pricesFile = setting(env, 'ENERGY_REPORT_PRICES_FILE', '/config/energy.json')
  return {
    influx: {
      url: INFLUX_URL,
      database: INFLUX_DB,
      read: { username: secret(env, readFile, 'INFLUXDB_READ_USERNAME'), password: secret(env, readFile, 'INFLUXDB_READ_PASSWORD') },
      write: { username: secret(env, readFile, 'INFLUXDB_USERNAME'), password: secret(env, readFile, 'INFLUXDB_PASSWORD') }
    },
    telegramUrl: TELEGRAM_URL,
    dashboardUrl: url(env, 'ENERGY_REPORT_DASHBOARD_URL', 'http://grafana/d/energy-monthly'),
    firstMonth,
    // Older months had other prices, in BGN, so they get no cost.
    pricesFrom: month(env, 'ENERGY_REPORT_PRICES_FROM', '2026-07'),
    prices: gridPrices(JSON.parse(readFile(pricesFile, 'utf8')))
  }
}
