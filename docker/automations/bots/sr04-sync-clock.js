const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIMER_FIELDS = ['ss', 'mm', 'hh', 'dayWeek', 'day', 'month', 'year']
// A write is sent only while the local seconds are in this range, away from a
// full minute. The driver's four register writes take well under a second, so
// the controller's clock cannot reach the next minute, or hour, between them.
const MIN_WRITE_SECOND = 5
const MAX_WRITE_SECOND = 50

const pad = (val) => String(val).padStart(2, '0')

// A timer as text, e.g. "2026-10-20 14:01:27 Tue"
const showTimer = ({ ss, mm, hh, dayWeek, day, month, year }) =>
  `20${pad(year)}-${pad(month)}-${pad(day)} ${pad(hh)}:${pad(mm)}:${pad(ss)} ${WEEK_DAYS[dayWeek] ?? '?'}`

// A timer as milliseconds, to compare two wall clock times. Both are read as
// UTC, so no time zone takes part in the difference.
const wallClockMs = ({ ss, mm, hh, day, month, year }) => Date.UTC(2000 + year, month - 1, day, hh, mm, ss)

// The week day of the timer's own date, 0 is Sunday
const weekDayOf = (timer) => new Date(wallClockMs(timer)).getUTCDay()

const fullTimer = (timer) => timer != null && typeof timer === 'object' &&
  TIMER_FIELDS.every((field) => Number.isInteger(timer[field]))

/**
 * Keeps the clock of the Microsyst SR-04 solar controller on the local time of
 * `timeZone`, the summer and winter time changes included (#1752).
 *
 * The clock in each reading is compared with the local time of the reading.
 * When it is more than `maxDriftSeconds` off, or its week day does not match
 * its own date, the bot sends the local time now to `<topic>/write` as
 * `{ timer: { ss, mm, hh, dayWeek, day, month, year } }` (dayWeek 0 is Sunday,
 * year has two digits). The driver writes only the clock registers.
 *
 * It does not write while the local seconds are under 5 or over 50; a later
 * reading writes instead. It writes at most once in `minWriteIntervalMs`, so
 * the readings already on their way, which still show the old time, do not
 * cause a second write.
 */
module.exports = (name, {
  topic,
  timeZone = 'Europe/Sofia',
  maxDriftSeconds = 30,
  minWriteIntervalMs = 15 * 60 * 1000,
}) => ({
  start: async ({ mqtt }) => {
    const readingTopic = `${topic}/reading`
    const writeTopic = `${topic}/write`
    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
    // The local wall clock at `time`, in the shape of the controller's timer
    const localTimer = (time) => {
      const parts = Object.fromEntries(clock.formatToParts(time).map(({ type, value }) => [type, value]))
      return {
        ss: Number(parts.second),
        mm: Number(parts.minute),
        hh: Number(parts.hour),
        dayWeek: WEEK_DAYS.indexOf(parts.weekday),
        day: Number(parts.day),
        month: Number(parts.month),
        year: Number(parts.year) % 100,
      }
    }

    let lastWriteAt = null

    await mqtt.subscribe(readingTopic, (payload) => {
      const timer = payload?.timer
      if (typeof payload?._tz !== 'number' || !fullTimer(timer)) return

      const local = localTimer(payload._tz)
      // Positive when the controller is ahead
      const driftSeconds = Math.round((wallClockMs(timer) - wallClockMs(local)) / 1000)
      // The week day is checked against the timer's own date, so a clock a few
      // seconds off is not written just after midnight
      if (Math.abs(driftSeconds) <= maxDriftSeconds && timer.dayWeek === weekDayOf(timer)) return

      const now = Date.now()
      if (lastWriteAt != null && now - lastWriteAt < minWriteIntervalMs) return
      const next = localTimer(now)
      if (next.ss < MIN_WRITE_SECOND || next.ss > MAX_WRITE_SECOND) return

      lastWriteAt = now
      console.log(`[${name}] setting the clock from ${showTimer(timer)} to ${showTimer(next)} (it was ${driftSeconds} s off)`)
      mqtt.publish(writeTopic, { timer: next })
    })
  }
})
