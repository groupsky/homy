// The evening hot water plan of the boiler controller (#1985).
//
// - The baths an evening used, from an energy balance on the tank model of
//   lib/boiler-tank.js.
// - The need of an evening: the mean of the last same weekdays, or a table
//   by season and weekday until there are enough of them.
// - The minutes the element needs to store a number of litres, with its
//   real power.
//
// How the controller uses them: docker/automations/docs/boiler-controller.md.

const tank = require('./boiler-tank')

const KWH_PER_L_K = 1.163 / 1000
const DAY_MS = 24 * 60 * 60 * 1000

const minutesOfDay = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

// Returns a function that reads a moment on the wall clock of `timeZone`:
// the date (YYYY-MM-DD), the weekday (0 = Monday ... 6 = Sunday), the month
// (1-12) and the minutes since midnight.
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
const localClock = (timeZone) => {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  })
  return (ms) => {
    const p = Object.fromEntries(format.formatToParts(ms).map(({ type, value }) => [type, value]))
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      weekday: WEEKDAYS[p.weekday],
      month: Number(p.month),
      minutes: Number(p.hour) * 60 + Number(p.minute)
    }
  }
}

// Days since 1970-01-01 of a YYYY-MM-DD date, or null for a bad date.
const dayNumber = (date) => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : null
}

// Energy (kWh) the tank holds above the cold water, on the gradual profile.
const storedKwh = (top, bottom, cold, model = tank.DEFAULT_TANK) => {
  const litresPerLayer = model.litres / model.layers
  return tank.gradualProfile(bottom, top, cold, model)
    .reduce((sum, t) => sum + litresPerLayer * KWH_PER_L_K * (t - cold), 0)
}

// The baths an evening used:
//   used = stored(start) - stored(end) + element energy - standby loss
//   baths = used / (bathLitres x 1.163 x (bathTempC - cold) / 1000)
// start, end: { top, bottom } °C. elementKwh: the energy the element gave
// in between. hours: the time between start and end. Null when an input is
// missing.
const eveningBaths = ({ start, end, elementKwh, hours, standbyW, cold, bathLitres, bathTempC, model = tank.DEFAULT_TANK }) => {
  const numbers = [start?.top, start?.bottom, end?.top, end?.bottom, elementKwh, hours, standbyW, cold, bathLitres, bathTempC]
  if (!numbers.every(Number.isFinite) || !(bathTempC > cold) || !(bathLitres > 0)) return null
  const used = storedKwh(start.top, start.bottom, cold, model) - storedKwh(end.top, end.bottom, cold, model) +
    elementKwh - standbyW * hours / 1000
  return used / tank.bathKwh(bathLitres, bathTempC, cold)
}

// An evening value worth using: a number of baths from 0 to maxBaths.
const validBaths = (value, maxBaths) => Number.isFinite(value) && value >= 0 && value <= maxBaths

// The mean of the last `count` stored evenings on the same weekday as
// `date`, within `maxDays` before it. Null when there are fewer than
// `count` such evenings (the caller then uses the season table).
// history: { 'YYYY-MM-DD': baths }. Bad dates and values are skipped.
const learnedNeed = (history, date, { count, maxDays, maxBaths }) => {
  const day = dayNumber(date)
  if (day === null || history === null || typeof history !== 'object') return null
  const same = Object.entries(history)
    .map(([d, baths]) => ({ day: dayNumber(d), baths }))
    .filter(({ day: d, baths }) => d !== null && validBaths(baths, maxBaths) &&
      d < day && day - d <= maxDays && (day - d) % 7 === 0)
    .sort((a, b) => b.day - a.day)
    .slice(0, count)
  if (same.length < count) return null
  return same.reduce((sum, { baths }) => sum + baths, 0) / count
}

// The table value for a month (1-12) and weekday (0 = Monday), or null.
// table: [{ months: [11, 12, 1, 2, 3], baths: [Mon, ..., Sun] }, ...]
const seasonNeed = (table, month, weekday) => {
  if (!Array.isArray(table)) return null
  const season = table.find((row) => Array.isArray(row?.months) && row.months.includes(month))
  const baths = season && Array.isArray(season.baths) ? season.baths[weekday] : null
  return Number.isFinite(baths) && baths >= 0 ? baths : null
}

// Minutes the element needs, from the profile `profile`, until the tap has
// `litres` of water at bathTempC or the top layer reaches topLimit (the
// tank is then as full as the limit lets it be). Steps of 5 min, at most
// 10 h.
const STEP_MIN = 5
const minutesToStore = ({ profile, cold, bathTempC, litres, powerTable, topLimit, model = tank.DEFAULT_TANK }) => {
  const T = profile.slice()
  const litresPerLayer = model.litres / model.layers
  for (let m = 0; m < 600; m += STEP_MIN) {
    if (tank.usableLitres(T, cold, bathTempC, model) >= litres || T[model.layers - 1] >= topLimit) return m
    const kw = tank.elementPowerKw(powerTable, T[model.elementLayer])
    T[model.elementLayer] += kw * STEP_MIN * 60 / (litresPerLayer * 4.186)
    tank.mixInversions(T)
  }
  return 600
}

module.exports = {
  minutesOfDay,
  localClock,
  dayNumber,
  storedKwh,
  eveningBaths,
  validBaths,
  learnedNeed,
  seasonNeed,
  minutesToStore
}
