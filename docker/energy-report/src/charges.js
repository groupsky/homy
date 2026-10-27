// The Ioniq charges (#1854): home or away from the house charger meter, the
// cost of a home charge, the InfluxDB points and the summary for Home Assistant.
import { HOUR, hourlyIncreases, zoneAt } from './hourly.js'
import { monthOf } from './time.js'

export const CHARGES = 'ioniq_charges'
export const CHARGES_TOPIC = 'homy/ioniq/charges'

// A charge is home when the house charger meter took at least this much
// energy during it. Away charges show 0.00 kWh on the meter, and the smallest
// home charge so far took 1.1 kWh, so the line is far from both.
export const HOME_MIN_KWH = 0.5
// The Ioniq's on-board AC charger takes at most 7.2 kW, so a charge above
// this average or peak power is DC.
export const DC_MIN_KW = 8
// The same limit as the monthly report: no meter here counts more in one hour.
const MAX_KWH_PER_HOUR = 50
const SUMMARY_CHARGES = 10

const round = (x, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits
const orNull = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const maybe = (x, digits) => (x === null ? null : round(x, digits))

// The charger meter's energy in a charge, split by tariff zone, as
// { kwh, day, night }, or null without any reading in the charge. `first` is
// the first counter reading at or after `startMs`, `hourly` the last reading
// of each hour of the charge ([hourStartMs, value]). The first reading stands
// for the end of the hour before the start, so the start hour gets the
// energy from the start on; gaps are spread over their hours, with the rules
// of the monthly report.
export function meterEnergy (startMs, first, hourly) {
  if (first === undefined || first === null) return null
  const points = [[Math.floor(startMs / HOUR) * HOUR - HOUR, first], ...hourly]
  const { energy } = hourlyIncreases(points, MAX_KWH_PER_HOUR)
  let day = 0
  let night = 0
  for (const [hour, kwh] of energy) {
    if (zoneAt(hour) === 'night') night += kwh
    else day += kwh
  }
  return { kwh: day + night, day, night }
}

function typeOf (place, avgKw, maxKw) {
  if (place === 'home') return 'AC'
  if (avgKw > DC_MIN_KW || maxKw > DC_MIN_KW) return 'DC'
  return avgKw !== null || maxKw !== null ? 'AC' : 'unknown'
}

// One charge. `session` is a charge of ioniq_sessions; `meter` comes from
// meterEnergy; `carMinKw` is the lowest hv_kw the car logged in the charge
// (negative while it charges), and `meterMaxW` the charger meter's peak power.
export function chargeRow (session, { meter, carMinKw, meterMaxW }, { prices, pricesFrom }) {
  const month = monthOf(session.start)
  const place = meter === null ? 'unknown' : meter.kwh >= HOME_MIN_KWH ? 'home' : 'away'
  const home = place === 'home'
  const avgKw = session.duration_is_charge ? orNull(session.power_avg_kw) : null
  // At home the charger meter's peak (on the AC side): it sees the whole
  // charge, and the car logs only while it is awake. Away the car's own peak,
  // when it was awake while charging.
  let maxKw = null
  if (home) maxKw = orNull(meterMaxW) !== null && meterMaxW > 0 ? meterMaxW / 1000 : null
  else if (orNull(carMinKw) !== null && carMinKw < 0) maxKw = -carMinKw
  // Older months had other prices, in BGN: they get no cost, as in the report.
  const priced = home && month >= pricesFrom
  const costDay = priced ? round(meter.day * prices.day) : null
  const costNight = priced ? round(meter.night * prices.night) : null
  return {
    start: session.start,
    end: orNull(session.end),
    month,
    place,
    type: typeOf(place, avgKw, maxKw),
    soc_start: orNull(session.soc_start),
    soc_end: orNull(session.soc_end),
    battery_kwh: maybe(orNull(session.energy_in_kwh)),
    meter_kwh: home ? round(meter.kwh) : null,
    meter_kwh_day: home ? round(meter.day) : null,
    meter_kwh_night: home ? round(meter.night) : null,
    // the sum of the rounded parts, so day + night is the cost
    cost_eur: priced ? round(costDay + costNight) : null,
    cost_day_eur: costDay,
    cost_night_eur: costNight,
    duration_min: session.duration_is_charge && orNull(session.duration_sec) !== null ? round(session.duration_sec / 60, 1) : null,
    power_avg_kw: maybe(avgKw),
    power_max_kw: maybe(maxKw)
  }
}

const TAGS = ['month', 'place', 'type']
export const FIELDS = [
  ['end', 'end_ts'], ['soc_start'], ['soc_end'], ['battery_kwh'], ['meter_kwh'], ['meter_kwh_day'], ['meter_kwh_night'],
  ['cost_eur'], ['cost_day_eur'], ['cost_night_eur'], ['duration_min'], ['power_avg_kw'], ['power_max_kw']
].map(([key, field = key]) => ({ key, field }))

// InfluxDB line protocol, one point per charge at its start, like
// ioniq_sessions. Empty fields are left out. The same charge written again
// replaces its point.
export function toChargeLines (rows) {
  return rows.map((row) => {
    const tags = TAGS.map((t) => `${t}=${row[t]}`).join(',')
    const fields = FIELDS.filter(({ key }) => row[key] !== null).map(({ key, field }) => `${field}=${row[key]}`).join(',')
    return `${CHARGES},${tags} ${fields} ${row.start}`
  })
}

// A row back from a stored point of ioniq_charges, as { column: value }.
export function rowFromPoint (point) {
  const row = { start: point.time }
  for (const t of TAGS) row[t] = point[t]
  for (const { key, field } of FIELDS) row[key] = orNull(point[field])
  return row
}

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0)

// The retained message for Home Assistant: the last 10 charges, newest
// first, and the totals of the local month of `nowMs`. The month has no cost
// before the month of the current prices.
export function chargeSummary (rows, nowMs, pricesFrom) {
  const month = monthOf(nowMs)
  const sorted = [...rows].sort((a, b) => b.start - a.start)
  const inMonth = sorted.filter((row) => row.month === month)
  const home = inMonth.filter((row) => row.place === 'home')
  const priced = month >= pricesFrom
  return {
    updated: new Date(nowMs).toISOString(),
    month,
    totals: {
      count: inMonth.length,
      home: home.length,
      kwh: round(sum(inMonth, 'battery_kwh'), 1),
      meter_kwh: round(sum(home, 'meter_kwh'), 1),
      cost: priced ? round(sum(home, 'cost_eur'), 2) : null,
      cost_day: priced ? round(sum(home, 'cost_day_eur'), 2) : null,
      cost_night: priced ? round(sum(home, 'cost_night_eur'), 2) : null
    },
    charges: sorted.slice(0, SUMMARY_CHARGES).map((row) => ({
      start: new Date(row.start).toISOString(),
      place: row.place,
      type: row.type,
      soc_from: row.soc_start,
      soc_to: row.soc_end,
      kwh: maybe(row.battery_kwh, 1),
      meter_kwh: maybe(row.meter_kwh, 1),
      min: maybe(row.duration_min, 0),
      avg_kw: maybe(row.power_avg_kw, 1),
      max_kw: maybe(row.power_max_kw, 1),
      cost: maybe(row.cost_eur, 2),
      cost_day: maybe(row.cost_day_eur, 2),
      cost_night: maybe(row.cost_night_eur, 2)
    }))
  }
}
