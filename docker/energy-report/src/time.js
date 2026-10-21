// Local months (Europe/Sofia) and the run times of the report.
//
// A month is written 'YYYY-MM'. Its hours are the hours from 00:00 local on
// the 1st to 00:00 local on the 1st of the next month, so a month with a clock
// change has 743 or 745 hours.

// The report of a month runs at 00:30 local on the 1st of the next month, so
// the last readings of the month have arrived.
const RUN_DELAY = 30 * 60 * 1000
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

const localTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sofia',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23'
})

function localParts (ms) {
  const parts = Object.fromEntries(localTime.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]))
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second }
}

// How far local time is ahead of UTC at `ms`.
function offsetAt (ms) {
  const p = localParts(ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

// The UTC time of a local wall time. Exact for any time away from a clock
// change; the report needs only midnight on the 1st, which is never one.
function localToUtc (year, month, day, hour = 0, minute = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const guess = wall - offsetAt(wall)
  return wall - offsetAt(guess)
}

export function isMonth (text) {
  return typeof text === 'string' && MONTH.test(text)
}

function parseMonth (month) {
  const match = typeof month === 'string' && month.match(MONTH)
  if (!match) throw new Error(`not a month in the form YYYY-MM: ${month}`)
  return [Number(match[1]), Number(match[2])]
}

const format = (year, month) => `${year}-${String(month).padStart(2, '0')}`

export function addMonths (month, n) {
  const [year, m] = parseMonth(month)
  const index = year * 12 + (m - 1) + n
  return format(Math.floor(index / 12), (index % 12) + 1)
}

// The first hour of the month and the first hour after it, in UTC ms.
export function monthBounds (month) {
  const [year, m] = parseMonth(month)
  const [nextYear, next] = parseMonth(addMonths(month, 1))
  return { start: localToUtc(year, m, 1), end: localToUtc(nextYear, next, 1) }
}

// The local month of a time.
export function monthOf (ms) {
  const p = localParts(ms)
  return format(p.year, p.month)
}

// The months from `first` to `last`, both included, oldest first.
export function monthsBetween (first, last) {
  const months = []
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m)
  return months
}

// The local day of the month of a time.
export function localDay (ms) {
  return localParts(ms).day
}

// The newest month whose report time (00:30 on the 1st after it) has come.
export function lastReadyMonth (ms) {
  return addMonths(monthOf(ms - RUN_DELAY), -1)
}

// The first report time after `ms`: 00:30 local on a 1st. Midnight on the 1st
// is never at a clock change, so 30 minutes after it is 00:30 local.
export function nextRunAfter (ms) {
  const month = monthOf(ms)
  const thisMonth = monthBounds(month).start + RUN_DELAY
  return thisMonth > ms ? thisMonth : monthBounds(addMonths(month, 1)).start + RUN_DELAY
}
