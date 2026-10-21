// The meters of the report and the numbers of one month.
import { addMonths, localDay, monthOf, monthsBetween } from './time.js'

export const MEASUREMENT = 'energy_monthly'
export const NOT_METERED = 'not_metered'

// The physical meters of scripts/energy-backfill/index.mjs (GRID_SOURCES and
// DEVICE_SOURCES) that count from 2023-11, after the main meter was swapped on
// 2023-10-15/16. Each one is picked by its tags, so a meter swap is never
// counted as use. Left out on purpose:
// - kitchen (dead since 2025-09) and waste_pump (dead since 2026-06);
// - the voltage stabiliser meter: it feeds the charger, the borehole pump and
//   the microwave, so it would count them twice.
const meter = (name, measurement, bus, device, type, field) => ({ name, measurement, bus, device, type, field })
const secondary = (device, type) => meter(device, 'power_meter', 'secondary', device, type, 'total')
export const MAIN = meter('main', 'power_meter', 'primary', 'main', 'sdm630', 'total')
export const LOADS = [
  secondary('water_pump', 'ex9em'),
  secondary('oven', 'dds519mr'),
  secondary('stove', 'dds519mr'),
  secondary('dishwasher', 'dds519mr'),
  secondary('laundry', 'dds519mr'),
  secondary('boiler', 'dds519mr'),
  meter('heat_pump', 'power_meter', 'tetriary', 'heat_pump', 'dds024mr', 'total'),
  secondary('microwave', 'or-we-514'),
  meter('charger', 'xymd1', 'monitoring', 'charger', 'or-we-526', 'tot_act')
]

const round = (x) => Math.round(x * 1000) / 1000
const percent = (part, whole) => round((part / whole) * 100)

// The fields of one meter (or of main, or of not_metered) in one month.
function fieldsOf (meterName, { kwh, day, night }, { month, mainKwh, prices, pricesFrom, lastYear }) {
  const fields = { kwh: round(kwh), kwh_day: round(day), kwh_night: round(night) }
  if (mainKwh > 0) fields.share_pct = percent(kwh, mainKwh)
  if (kwh > 0) fields.night_share_pct = percent(night, kwh)
  // Older months had other prices, in BGN: they get no cost.
  if (month >= pricesFrom) fields.cost_eur = round(day * prices.day + night * prices.night)
  const last = lastYear[meterName]
  if (last !== undefined) {
    fields.kwh_last_year = round(last)
    if (last > 0) fields.change_pct = percent(kwh - last, last)
  }
  return fields
}

// The rows of one month: main, each meter, and not_metered (main minus the
// sum of the meters). `main` and each of `loads` are { kwh, day, night };
// `lastYear` is the kWh of each meter in the same month of last year, as far
// as it is stored.
export function monthReport ({ month, main, loads, prices, pricesFrom, lastYear = {} }) {
  const context = { month, mainKwh: main.kwh, prices, pricesFrom, lastYear }
  const notMetered = { kwh: main.kwh, day: main.day, night: main.night }
  const rows = [{ meter: MAIN.name, fields: fieldsOf(MAIN.name, main, context) }]
  for (const [name, energy] of Object.entries(loads)) {
    rows.push({ meter: name, fields: fieldsOf(name, energy, context) })
    notMetered.kwh -= energy.kwh
    notMetered.day -= energy.day
    notMetered.night -= energy.night
  }
  rows.push({ meter: NOT_METERED, fields: fieldsOf(NOT_METERED, notMetered, context) })
  return rows
}

// InfluxDB line protocol, one point per row, at `timeMs` (the start of the
// month). A second write of the same month, meter and time overwrites the
// fields it writes; a field it leaves out keeps its old value.
export function toLineProtocol (month, rows, timeMs) {
  return rows.map(({ meter, fields }) => {
    const values = Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(',')
    return `${MEASUREMENT},meter=${meter},month=${month} ${values} ${timeMs}`
  })
}

// The months from `first` to `last` that are not stored yet, oldest first, so
// that each month can find the same month of last year.
export function monthsToCompute ({ stored, first, last }) {
  return monthsBetween(first, last).filter((month) => !stored.has(month))
}

// At start, the report of the previous month is sent only when this start has
// just computed it, and only on the 1st to the 3rd. So a deploy late in the
// month sends nothing, and a restart on the 1st does not send it twice.
export function shouldSendOnStart (nowMs, computed) {
  return computed.includes(addMonths(monthOf(nowMs), -1)) && localDay(nowMs) <= 3
}
