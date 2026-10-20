const telegramAlert = require('../lib/telegram-alert')

const MIN = 60 * 1000
const HOUR = 60 * MIN
const SAMPLE_KEEP_MS = 36 * HOUR

const CHECKS = ['valveOpenLong', 'lowCoolingTargetTemp', 'coolingInColdNights']

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * Reads the exception list, a comma-separated list of `room:check` pairs, for
 * example `thermostat-x:coolingInColdNights`. A room that needs several
 * exceptions has several pairs. Returns `skip` (room -> list of checks) and
 * `unknown` (the pairs that are not valid, which are left out).
 */
const parseSkip = (text) => {
  const skip = {}
  const unknown = []
  for (const raw of String(text ?? '').split(',')) {
    const pair = raw.trim()
    if (pair === '') continue
    const [room, check, ...extra] = pair.split(':').map((part) => part.trim())
    if (!room || !CHECKS.includes(check) || extra.length > 0) {
      unknown.push(pair)
      continue
    }
    skip[room] = [...(skip[room] ?? []), check]
  }
  return { skip, unknown }
}

// The local date and hour of a time, in the given zone
const localParts = (ms, timeZone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
    }).formatToParts(new Date(ms)).map(({ type, value }) => [type, value])
  )
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) }
}

const dateKey = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)

/**
 * Warns when a room thermostat looks wrong for the season (#1739). It only
 * sends Telegram messages. It never writes to a thermostat.
 *
 * - `valveOpenLong`: cooling mode with the valve open without a break for more
 *   than `valveOpenMaxMs`, in the local months of `valveOpenMonths`. A gap of
 *   more than `readingGapMs` between two readings of a room restarts the count,
 *   because the valve state in between is not known.
 * - `lowCoolingTargetTemp`: cooling mode with a set point under
 *   `minCoolingTargetTemp`. In cooling mode a low set point keeps the valve
 *   open and the borehole pump runs on.
 * - `coolingInColdNights`: cooling mode while the last night was cold. The
 *   last night is the newest local window `nightStartHour`..`nightEndHour`
 *   with at least `minNightSamples` outdoor values; it may be the night in
 *   progress. Cold means a minimum under `coldNightC`. Outdoor values come
 *   from the weather service (internet data): one is kept only when it is at
 *   most `outdoorMaxAgeMs` old on arrival. When the newest kept value is older
 *   than `outdoorHoldMs`, or no night has enough values, this check is
 *   skipped (docker/weather/CLAUDE.md, step 4: normal behaviour).
 * - One message for each problem, room and local day. The sent list is kept
 *   over a restart.
 * - `skip` lists `room:check` pairs that are not checked (see parseSkip).
 *
 * All decisions use the time of the reading (`_tz`), never the clock, so old
 * messages can be replayed.
 */
module.exports = (name, {
  thermostatTopics = [],
  outdoorTopic,
  skip: skipText = '',
  valveOpenMaxMs = 3 * HOUR,
  valveOpenMonths = [10, 11, 12, 1, 2, 3, 4],
  minCoolingTargetTemp = 15,
  coldNightC = 8,
  nightStartHour = 22,
  nightEndHour = 7,
  minNightSamples = 12,
  outdoorMaxAgeMs = HOUR,
  outdoorHoldMs = 12 * HOUR,
  readingGapMs = 15 * MIN,
  timeZone = 'Europe/Sofia',
  telegramWebhookUrl,
  httpPost
}) => ({
  persistedCache: {
    version: 1,
    default: {
      // `room:check` -> the local day (YYYY-MM-DD) of the last message
      sent: {},
      // room -> { since, last }: when the valve opened and the time of the
      // last reading, both in ms
      openSince: {},
      // Fresh outdoor values of the last 36 h: [{ temperature, time }] (ms)
      outdoorSamples: []
    }
  },

  start: ({ mqtt, persistedCache, isEnabled = () => true }) => {
    const say = (message) => console.log(`[${name}] ${message}`)
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost, isEnabled })
    const { skip, unknown } = parseSkip(skipText)
    for (const pair of unknown) {
      console.error(`[${name}] ignored the exception "${pair}": it must be room:check, with a check of ${CHECKS.join(', ')}`)
    }

    let haveOutdoor = null
    // The latest time seen in any message; the age of the outdoor values
    // is measured from it
    let latest = 0

    const timeOf = (payload) => (isNumber(payload?._tz) ? payload._tz : Date.now())

    const send = (room, check, now, text) => {
      if (skip[room]?.includes(check)) return
      const { year, month, day } = localParts(now, timeZone)
      const today = dateKey(year, month, day)
      const key = `${room}:${check}`
      if (persistedCache.sent[key] === today) return
      // Older days are dropped so the list stays small
      const sent = Object.fromEntries(Object.entries(persistedCache.sent).filter(([, d]) => d >= today))
      sent[key] = today
      persistedCache.sent = sent
      say(`${room} ${check}: ${text}`)
      alert(name, `⚠️ ${room} (${check}): ${text} Nothing was changed.`)
    }

    // The night window a time belongs to, named by the local date it starts
    // on, or null for a time in the day
    const nightOf = (ms) => {
      const { year, month, day, hour } = localParts(ms, timeZone)
      if (hour >= nightStartHour) return dateKey(year, month, day)
      if (hour < nightEndHour) return dateKey(year, month, day - 1)
      return null
    }

    // The minimum of the last night with enough values, or null without data
    const lastNightMin = (now) => {
      const samples = persistedCache.outdoorSamples
      if (samples.length === 0) return null
      const newest = Math.max(...samples.map((sample) => sample.time))
      if (now - newest > outdoorHoldMs) return null
      const nights = new Map()
      for (const { temperature, time } of samples) {
        const night = nightOf(time)
        if (night == null) continue
        const values = nights.get(night) ?? []
        values.push(temperature)
        nights.set(night, values)
      }
      const enough = [...nights.keys()].filter((night) => nights.get(night).length >= minNightSamples).sort()
      if (enough.length === 0) return null
      return Math.min(...nights.get(enough[enough.length - 1]))
    }

    const checkValve = (room, payload, now) => {
      const open = payload.mode === 'cooling' && payload.valveStatus === 'on'
      const previous = persistedCache.openSince[room]
      const openSince = { ...persistedCache.openSince }
      if (!open) {
        if (previous) {
          delete openSince[room]
          persistedCache.openSince = openSince
        }
        return
      }
      const continuing = previous && now - previous.last <= readingGapMs && now >= previous.last
      const since = continuing ? previous.since : now
      openSince[room] = { since, last: now }
      persistedCache.openSince = openSince
      const { month } = localParts(now, timeZone)
      if (valveOpenMonths.includes(month) && now - since > valveOpenMaxMs) {
        const hours = Math.round((now - since) / HOUR * 10) / 10
        send(room, 'valveOpenLong', now,
          `the cooling valve has been open for ${hours} h in cooling mode (set point ${payload.targetTemp} °C, room ${payload.currentTemp} °C).`)
      }
    }

    const onReading = (room) => (payload) => {
      if (typeof payload?.mode !== 'string' || !isNumber(payload.targetTemp)) return
      const now = timeOf(payload)
      latest = Math.max(latest, now)

      checkValve(room, payload, now)
      if (payload.mode !== 'cooling') return

      if (payload.targetTemp < minCoolingTargetTemp) {
        send(room, 'lowCoolingTargetTemp', now,
          `the set point is ${payload.targetTemp} °C in cooling mode. In cooling mode a low set point keeps the valve open and the borehole pump runs on.`)
      }

      const min = lastNightMin(now)
      const have = min != null
      if (have !== haveOutdoor) {
        say(have ? 'outdoor data is available: the cold night check is on'
          : `no outdoor data (newest value older than ${Math.round(outdoorHoldMs / HOUR)} h, or no night with ${minNightSamples} values): the cold night check is off`)
        haveOutdoor = have
      }
      if (have && min < coldNightC) {
        send(room, 'coolingInColdNights', now,
          `the thermostat is in cooling mode and the last night was cold (lowest outdoor temperature ${min} °C, limit ${coldNightC} °C).`)
      }
    }

    for (const topic of thermostatTopics) {
      const room = topic.split('/').filter(Boolean).pop()
      mqtt.subscribe(`${topic}/reading`, onReading(room))
    }

    // Only a fresh value is kept, once per time: the retained message comes
    // again after a reconnect.
    if (outdoorTopic) {
      mqtt.subscribe(outdoorTopic, (payload) => {
        const time = Date.parse(payload?.time)
        if (!isNumber(payload?.temperature) || !Number.isFinite(time)) return
        const arrived = timeOf(payload)
        latest = Math.max(latest, arrived)
        if (arrived - time > outdoorMaxAgeMs) return
        const samples = persistedCache.outdoorSamples
          .filter((sample) => latest - sample.time <= SAMPLE_KEEP_MS)
        if (samples.some((sample) => sample.time === time)) return
        persistedCache.outdoorSamples = [...samples, { temperature: payload.temperature, time }]
      })
    }
  }
})

module.exports.parseSkip = parseSkip
module.exports.CHECKS = CHECKS
