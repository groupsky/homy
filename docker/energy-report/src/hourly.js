// Hourly energy of a meter from its counter readings.
//
// zoneAt and hourlyIncreases are copies of the functions with the same names in
// scripts/energy-backfill/lib.mjs, with the same rules: a Docker build context
// cannot import from scripts/. hourly.test.js runs both copies on the same
// input, so a change to one of them fails the tests until the other follows.

export const HOUR = 3600 * 1000

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

// The energy of one meter in one month: the hours that start in
// [start, end), split into the day and the night zone. `points` should reach
// a few days before and after the month. Then the first hour has the reading
// before it, and a gap across the start or the end of the month is spread
// over both months. `dropped` lists the dropped jumps that end in the month.
export function monthEnergy (points, { start, end }, maxKwhPerHour) {
  const { energy, dropped } = hourlyIncreases(points, maxKwhPerHour)
  let day = 0
  let night = 0
  for (const [hour, kwh] of energy) {
    if (hour < start || hour >= end) continue
    if (zoneAt(hour) === 'night') night += kwh
    else day += kwh
  }
  return {
    kwh: day + night,
    day,
    night,
    dropped: dropped.filter(({ hour }) => hour >= start && hour < end)
  }
}
