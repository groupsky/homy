// InfluxDB 1.x over its HTTP API: reads with the read user, writes with the
// write user. The service writes only the energy_monthly measurement.
import { MEASUREMENT } from './report.js'

const authorization = ({ username, password }) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

export function createInflux ({ url, database, read, write }, fetch = globalThis.fetch) {
  return {
    // The series of the first statement's result, or [] when it has none.
    async query (q) {
      const params = new URLSearchParams({ db: database, q, epoch: 'ms' })
      const response = await fetch(`${url}/query?${params}`, { headers: { Authorization: authorization(read) } })
      if (!response.ok) throw new Error(`InfluxDB query: HTTP ${response.status}`)
      const result = (await response.json()).results?.[0]
      if (result?.error) throw new Error(`InfluxDB query: ${result.error}`)
      return result?.series ?? []
    },
    // Line protocol lines with times in milliseconds, in one request.
    async write (lines) {
      const params = new URLSearchParams({ db: database, precision: 'ms' })
      const response = await fetch(`${url}/write?${params}`, {
        method: 'POST',
        headers: { Authorization: authorization(write), 'Content-Type': 'text/plain; charset=utf-8' },
        body: lines.join('\n')
      })
      if (!response.ok) throw new Error(`InfluxDB write: HTTP ${response.status}`)
    }
  }
}

// The months that have a report in energy_monthly, from the `month` tag.
export async function storedMonths (influx) {
  const [series] = await influx.query(`SHOW TAG VALUES FROM "${MEASUREMENT}" WITH KEY = "month"`)
  return (series?.values ?? []).map(([, month]) => month)
}

// The last counter reading of each hour of one meter, as [hourStartMs, value],
// from `fromMs` up to `toMs`. The same query as scripts/energy-backfill: a
// reading of 0 or less is a bad reading, not a counter value.
export async function hourlyReadings (influx, { measurement, bus, device, type, field }, fromMs, toMs) {
  const [series] = await influx.query(
    `SELECT last("${field}") FROM "${measurement}" WHERE "bus" = '${bus}' AND "device.name" = '${device}' ` +
    `AND "device.type" = '${type}' AND "${field}" > 0 AND time >= ${fromMs}ms AND time < ${toMs}ms ` +
    'GROUP BY time(1h) fill(none)'
  )
  return series?.values ?? []
}

// The kWh of each meter in a stored month, as { meter: kWh }, from the
// newest point of each meter. No time range: the points are at the time
// they were written, and the month is the tag.
export async function lastYearKwh (influx, month) {
  const series = await influx.query(`SELECT "kwh" FROM "${MEASUREMENT}" WHERE "month" = '${month}' GROUP BY "meter" ORDER BY time DESC LIMIT 1`)
  return Object.fromEntries(series.map((s) => [s.tags.meter, s.values[0][1]]))
}
