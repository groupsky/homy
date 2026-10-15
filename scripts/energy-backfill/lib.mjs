// Pure logic of the energy backfill: turns hourly meter readings into the
// hourly statistics rows that Home Assistant imports. See docs/energy-dashboard.md.

const HOUR = 3600 * 1000

const localTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sofia',
  month: 'numeric',
  hour: 'numeric',
  hourCycle: 'h23'
})

// The EVN day/night zone of the hour that starts at `ms`. The same table as
// the automation "Grid tariff by zone": night is 22:00-06:00 from November to
// March and 23:00-07:00 from April to October, in local time.
export function zoneAt (ms) {
  const parts = Object.fromEntries(localTime.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const month = Number(parts.month)
  const hour = Number(parts.hour)
  const summer = month >= 4 && month <= 10
  const nightStart = summer ? 23 : 22
  const nightEnd = summer ? 7 : 6
  return hour >= nightStart || hour < nightEnd ? 'night' : 'day'
}

// `points` are [hourStartMs, last counter reading in that hour], sorted by
// time. Each hour gets the increase since the reading before it, like the
// utility meters: a step back counts as no energy and the counting goes on
// from the lower value. When readings are missing for some hours, the
// increase is spread evenly over them, so a gap does not show as one big hour.
// An increase above `maxKwhPerHour` for each of those hours cannot be real use
// (a meter swap or a bad reading), so it counts as no energy and is reported
// in `dropped`.
export function hourlyIncreases (points, maxKwhPerHour) {
  const energy = new Map()
  const dropped = []
  for (let i = 1; i < points.length; i++) {
    const [prevHour, prev] = points[i - 1]
    const [hour, value] = points[i]
    const hours = (hour - prevHour) / HOUR
    let increase = Math.max(0, value - prev)
    if (increase > maxKwhPerHour * hours) {
      dropped.push({ hour, from: prev, to: value })
      increase = 0
    }
    for (let h = prevHour + HOUR; h <= hour; h += HOUR) energy.set(h, increase / hours)
  }
  return { energy, dropped }
}

// Adds the hourly energy of `more` into `energy`, in place.
export function addEnergy (energy, more) {
  for (const [hour, kwh] of more) energy.set(hour, (energy.get(hour) ?? 0) + kwh)
  return energy
}

// Splits hourly energy into the day and the night tariff. Both maps keep every
// hour, so both tariffs have rows for the same hours.
export function splitByZone (energy) {
  const day = new Map()
  const night = new Map()
  for (const [hour, kwh] of energy) {
    const zone = zoneAt(hour)
    day.set(hour, zone === 'day' ? kwh : 0)
    night.set(hour, zone === 'night' ? kwh : 0)
  }
  return { day, night }
}

// The cost of each hour from `fromMs` on, at one fixed price.
export function priced (energy, price, fromMs) {
  const cost = new Map()
  for (const [hour, kwh] of energy) {
    if (hour >= fromMs) cost.set(hour, kwh * price)
  }
  return cost
}

const round = (x) => Math.round(x * 1e6) / 1e6

// Hourly statistics rows from the first hour with energy up to, not including,
// `endMs`. Every hour gets a row. The running sum starts from 0, because the
// dashboard takes the first row's sum as that hour's change. `state` is left
// out: the dashboard uses only `sum`.
export function statisticsRows (energy, endMs) {
  const hours = [...energy.keys()].filter((h) => h < endMs).sort((a, b) => a - b)
  if (hours.length === 0) return []
  const rows = []
  let running = 0
  for (let h = hours[0]; h < endMs; h += HOUR) {
    running += energy.get(h) ?? 0
    rows.push({ start: new Date(h).toISOString(), sum: round(running) })
  }
  return rows
}

// The energy of the hours from `fromMs` up to and including `toMs`.
export function energyBetween (energy, fromMs, toMs) {
  let total = 0
  for (const [hour, kwh] of energy) {
    if (hour >= fromMs && hour <= toMs) total += kwh
  }
  return round(total)
}

// How much to add to the live sums, from the first live row on, so that they
// go on from the last imported sum without a step. `liveSum` is the sum of
// the first live row, and `energySinceEnd` is the energy from the end of the
// import up to and including that row's hour, from the meter readings. After
// one adjustment the result is 0, so running the backfill again changes
// nothing.
export function liveAdjustment (lastImportedSum, energySinceEnd, liveSum) {
  return round(lastImportedSum + energySinceEnd - liveSum)
}
