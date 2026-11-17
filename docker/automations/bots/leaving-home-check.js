const telegramAlert = require('../lib/telegram-alert')

const HOUR = 60 * 60 * 1000

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

// Straight-line distance in metres between two {lat, lon} points
const distanceM = (a, b) => {
  const rad = (d) => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

// The local weekday (1 = Monday .. 7 = Sunday) and minutes since midnight
const localTime = (ms, timeZone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date(ms)).map(({ type, value }) => [type, value])
  )
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

/**
 * When the car leaves home on a workday morning, sends one Telegram message
 * that lists what is still on or open in the house (#1955).
 *
 * - Home is the retained `homeTopic` message ({lat, lon, radius_m}). Without
 *   it the bot does nothing.
 * - Only real GPS fixes count: provider `gps`, `acc_m` at most `maxAccuracyM`,
 *   and no `age_ms` (a set `age_ms` is a repeat of an old fix).
 * - A fix inside `radius_m` sets the state `home`. From `home`, the first fix
 *   more than `radius_m + marginM` away is a departure: the state becomes
 *   `away` and the check runs once, but only Monday to Friday between
 *   `windowStart` and `windowEnd` local time. Back inside re-arms it.
 * - The check uses the last values: lights and contacts with state true, and
 *   power meters above their `minW`. A value older than `maxValueAgeMs`, or
 *   never seen, is listed as unknown. Names in `ignore` are skipped.
 * - A message is sent only when at least one thing is on or open.
 */
module.exports = (name, {
  homeTopic = 'homy/ioniq/home',
  gpsTopic = 'ioniq/parsed/gps',
  featuresPrefix = 'homy/features',
  lights = [],
  contacts = [],
  meters = [],
  labels = {},
  ignore = [],
  marginM = 200,
  maxAccuracyM = 50,
  windowStart = '05:00',
  windowEnd = '10:00',
  timeZone = 'Europe/Sofia',
  maxValueAgeMs = 24 * HOUR,
  telegramWebhookUrl,
  httpPost
} = {}) => ({
  persistedCache: {
    version: 1,
    // `home`, `away` or null (not known yet)
    default: { place: null }
  },

  start: ({ mqtt, persistedCache, isEnabled = () => true }) => {
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost, isEnabled })
    const items = [
      ...lights.map((item) => ({ kind: 'light', name: item, topic: `${featuresPrefix}/light/${item}/status` })),
      ...meters.map((item) => ({ kind: 'meter', ...item })),
      ...contacts.map((item) => ({ kind: 'open', name: item, topic: `${featuresPrefix}/open/${item}/status` }))
    ].filter((item) => !ignore.includes(item.name))
    // topic -> { on, at }
    const values = new Map()
    let home = null
    let missingHomeLogged = false

    const label = (item) => labels[item.name] ?? item.name

    const check = (now) => {
      const groups = { light: [], meter: [], open: [], unknown: [] }
      for (const item of items) {
        const value = values.get(item.topic)
        if (!value || now - value.at > maxValueAgeMs) groups.unknown.push(label(item))
        else if (value.on) groups[item.kind].push(label(item))
      }
      const found = [
        groups.light.length && `светло: ${groups.light.join(', ')}`,
        groups.meter.length && `включено: ${groups.meter.join(', ')}`,
        groups.open.length && `отворено: ${groups.open.join(', ')}`
      ].filter(Boolean)
      console.log(`[${name}] the car left home: ${found.join('; ') || 'all off and closed'}${groups.unknown.length ? `; unknown: ${groups.unknown.join(', ')}` : ''}`)
      if (found.length === 0) return
      if (groups.unknown.length) found.push(`неизвестно: ${groups.unknown.join(', ')}`)
      alert(name, `🚗 Колата тръгна. Вкъщи: ${found.join('; ')}.`)
    }

    const inWindow = (ms) => {
      const { weekday, minutes } = localTime(ms, timeZone)
      return weekday <= 5 && minutes >= toMinutes(windowStart) && minutes < toMinutes(windowEnd)
    }

    mqtt.subscribe(homeTopic, (payload) => {
      if (!isNumber(payload?.lat) || !isNumber(payload?.lon) || !isNumber(payload?.radius_m)) return
      home = { lat: payload.lat, lon: payload.lon, radius: payload.radius_m }
    })

    mqtt.subscribe(gpsTopic, (payload) => {
      if (!payload || payload.provider !== 'gps') return
      if (!isNumber(payload.lat) || !isNumber(payload.lon)) return
      if (!isNumber(payload.acc_m) || payload.acc_m > maxAccuracyM) return
      if (payload.age_ms != null) return
      if (!home) {
        if (!missingHomeLogged) console.log(`[${name}] no home place on ${homeTopic} yet: doing nothing`)
        missingHomeLogged = true
        return
      }
      const distance = distanceM(home, payload)
      if (distance <= home.radius) {
        persistedCache.place = 'home'
      } else if (distance > home.radius + marginM && persistedCache.place !== 'away') {
        const left = persistedCache.place === 'home'
        persistedCache.place = 'away'
        const now = Date.now()
        if (left && inWindow(now)) check(now)
      }
    })

    for (const item of items) {
      mqtt.subscribe(item.topic, (payload) => {
        const at = isNumber(payload?._tz) ? payload._tz : Date.now()
        if (item.kind === 'meter') {
          if (isNumber(payload?.p)) values.set(item.topic, { on: payload.p > item.minW, at })
        } else if (typeof payload?.state === 'boolean') {
          values.set(item.topic, { on: payload.state, at })
        }
      })
    }
  }
})
