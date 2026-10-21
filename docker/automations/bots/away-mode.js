const telegramAlert = require('../lib/telegram-alert')

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const same = (a, b) => isNumber(a) && isNumber(b) && Math.abs(a - b) < 0.05
const roundHalf = (value) => Math.round(value * 2) / 2

// How far the local clock of a zone is ahead of UTC at a time, in ms
const zoneOffset = (ms, timeZone) => {
  const seconds = Math.floor(ms / 1000) * 1000
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(seconds)).map(({ type, value }) => [type, Number(value)])
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - seconds
}

/**
 * The moment 00:00 local time starts the date `YYYY-MM-DD` in the zone, in ms,
 * or null when the text is not a real date.
 */
const localMidnight = (text, timeZone) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const guess = Date.UTC(year, month - 1, day)
  if (new Date(guess).toISOString().slice(0, 10) !== text) return null
  // The offset is taken at the guess and again at the result, so a date next
  // to a clock change is right too
  const first = guess - zoneOffset(guess, timeZone)
  return guess - zoneOffset(first, timeZone)
}

const localText = (ms, timeZone) => new Intl.DateTimeFormat('sv-SE', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(new Date(ms))

const roomName = (topic) => topic.split('/').filter(Boolean).pop()

/**
 * Away mode (#1756): one switch sets the house back for a trip. Details:
 * docs/away-mode.md.
 *
 * - On: each room thermostat in heating mode (with a fresh reading) goes
 *   `setbackK` lower, and so does the living-room set point (not under
 *   `livingMin`). The old values are saved first. The boiler gets
 *   `vacation_until` (the return moment minus 6 h) or, without a return date,
 *   `vacation_14d`. No thermostat mode is ever changed.
 * - Return date: a local date, the return is 00:00 of that day. `restoreLeadMs`
 *   (3 days) before it the rooms go back, at the return the switch turns
 *   itself off. With the return less than 3 days away, the rooms are not set
 *   back at all.
 * - A value is put back only while it still shows the setback value, so a hand
 *   change made while away is kept.
 * - A write is checked in the next readings. If the new value does not show
 *   within `verifyMs`, it is written again, up to `maxTries` writes. After
 *   that the bot does not enforce it.
 * - The steps are checked every `checkMs` against the wall clock, and all
 *   state is persisted, so a restart does not move them.
 */
module.exports = (name, {
  thermostatTopics = [],
  livingRoomSetTopic,
  livingRoomStatusTopic,
  boilerSetTopic,
  boilerStatusTopic,
  switchSetTopic,
  switchStatusTopic,
  returnDateSetTopic,
  returnDateStatusTopic,
  setbackK = 3,
  livingMin = 16,
  roomMin = 5,
  readingMaxAgeMs = 10 * MIN,
  verifyMs = 3 * MIN,
  maxTries = 3,
  restoreLeadMs = 3 * DAY,
  boilerLeadMs = 6 * HOUR,
  // The boiler accepts an end time at most 60 days ahead
  boilerMaxAheadMs = 60 * DAY,
  checkMs = MIN,
  timeZone = 'Europe/Sofia',
  telegramWebhookUrl,
  httpPost
}) => ({
  persistedCache: {
    version: 1,
    default: {
      away: false,
      // The local date of the return, YYYY-MM-DD, or '' for none
      returnDate: '',
      // thermostat topic -> { home, setback }: values still to put back
      rooms: {},
      // { home, setback } of the living-room set point, or null
      living: null,
      // True when no room is waiting to be put back
      roomsDone: true,
      // The boiler mode seen before, and the one this bot set
      boiler: { before: null, set: null },
      // Writes that are not yet seen in a reading:
      // { kind: 'room' | 'living', topic, value, tries, deadline }
      pending: []
    }
  },

  start: ({ mqtt, persistedCache: state, isEnabled = () => true }) => {
    const say = (message) => console.log(`[${name}] ${message}`)
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost, isEnabled })
    const tell = (lines) => {
      const text = lines.filter(Boolean).join('\n')
      say(text.replace(/\n/g, ' | '))
      alert(name, text)
    }

    // The latest values seen. They are not saved: a restart waits for new ones.
    const readings = new Map()
    let living = null
    let boilerMode = null

    const now = () => Date.now()
    const returnMoment = () => (state.returnDate ? localMidnight(state.returnDate, timeZone) : null)
    const fresh = (topic) => {
      const reading = readings.get(topic)
      return reading && now() - reading.at <= readingMaxAgeMs ? reading : null
    }

    const publishSwitch = () => mqtt.publish(switchStatusTopic, { state: state.away }, { retain: true })
    const publishDate = () => mqtt.publish(returnDateStatusTopic, { value: state.returnDate }, { retain: true })

    const write = (kind, topic, value) => {
      if (kind === 'room') mqtt.publish(`${topic}/write`, { targetTemp: value })
      else mqtt.publish(livingRoomSetTopic, { setPoint: value })
    }
    const label = (kind, topic) => (kind === 'room' ? roomName(topic) : 'living room')

    // `before` is what the thermostat showed before the write; a later reading
    // that is neither `before` nor `value` is a change by hand
    const writeAndWatch = (kind, topic, value, before) => {
      write(kind, topic, value)
      state.pending = [
        ...state.pending.filter((p) => !(p.kind === kind && p.topic === topic)),
        { kind, topic, value, before, tries: 1, deadline: now() + verifyMs }
      ]
    }

    const seen = (kind, topic, value) => {
      if (!state.pending.some((p) => p.kind === kind && p.topic === topic && same(p.value, value))) return
      state.pending = state.pending.filter((p) => !(p.kind === kind && p.topic === topic && same(p.value, value)))
    }

    // The boiler mode is the one this bot set, or not known (no status yet)
    const boilerIsOurs = () => state.boiler.set != null &&
      (boilerMode == null || boilerMode === 'vacation_until' || boilerMode === 'vacation_14d')

    const boilerCommand = (returnAt) => {
      if (returnAt == null) return { mode: 'vacation_14d' }
      const until = returnAt - boilerLeadMs
      return until > now() ? { mode: 'vacation_until', until } : null
    }

    const WAIT = Symbol('wait')

    // Puts one saved value back. Returns a report line, null, or WAIT. Any
    // write of the setback that was never seen in a reading is dropped. If
    // one is still unconfirmed the unit may have taken it, so the home value
    // is written even when the reading looks like home.
    const restoreOne = (kind, topic, label, { home, setback }, current, mode, missing, final) => {
      if (current == null && !final) return WAIT
      const unconfirmed = state.pending.some((p) => p.kind === kind && p.topic === topic && same(p.value, setback))
      state.pending = state.pending.filter((p) => !(p.kind === kind && p.topic === topic))
      if (current == null) {
        if (unconfirmed) writeAndWatch(kind, topic, home, setback)
        return `${label}: ${missing}${unconfirmed ? `, home value ${home} written` : `, not put back (home value ${home})`}`
      }
      if (mode !== undefined && mode !== 'heating') return `${label}: mode is ${mode}, not put back (home value ${home})`
      if (same(current, setback) || (unconfirmed && same(current, home))) {
        writeAndWatch(kind, topic, home, setback)
        return same(current, home) ? null : `${label}: ${setback} -> ${home}`
      }
      if (same(current, home)) return null
      return `${label}: kept ${current} (changed by hand; home value was ${home})`
    }

    // Puts back what is still at the setback value. Returns report lines.
    // Without `final`, a room with no fresh reading waits for the next check.
    const restoreRooms = (final) => {
      const lines = []
      const rooms = { ...state.rooms }
      for (const [topic, entry] of Object.entries(rooms)) {
        const reading = fresh(topic)
        const line = restoreOne('room', topic, roomName(topic), entry, reading?.targetTemp, reading?.mode,
          'no fresh reading', final)
        if (line === WAIT) continue
        if (line) lines.push(line)
        delete rooms[topic]
      }
      state.rooms = rooms
      if (state.living) {
        const line = restoreOne('living', null, 'living room', state.living, living?.setPoint, undefined,
          'no set point seen', true)
        if (line) lines.push(line)
        state.living = null
      }
      if (Object.keys(state.rooms).length === 0) state.roomsDone = true
      return lines
    }

    const releaseBoiler = () => {
      if (state.boiler.set == null) return 'boiler: not set by away mode'
      if (boilerMode === 'automatic') return 'boiler: back to automatic'
      if (!boilerIsOurs()) return `boiler: kept ${boilerMode} (changed by hand)`
      mqtt.publish(boilerSetTopic, { mode: 'automatic' })
      return 'boiler: automatic'
    }

    const finish = (reason) => {
      const lines = restoreRooms(true)
      lines.push(releaseBoiler())
      state.away = false
      state.returnDate = ''
      state.boiler = { before: null, set: null }
      state.roomsDone = true
      publishSwitch()
      publishDate()
      tell([reason === 'back' ? 'Back: away mode is off.' : 'Return date reached: away mode is off.', ...lines])
    }

    const turnOn = () => {
      if (state.away) {
        say('away mode is already on')
        publishSwitch()
        return
      }
      const returnAt = returnMoment()
      if (state.returnDate && (returnAt == null || returnAt <= now() || returnAt - boilerLeadMs > now() + boilerMaxAheadMs)) {
        publishSwitch()
        tell([`Away mode not started: the return date ${state.returnDate} must be in the future and under 60 days ahead.`])
        return
      }

      const setBack = returnAt == null || returnAt - restoreLeadMs > now()
      const rooms = {}
      const lines = []
      const skipped = []
      let livingPlan = null
      if (setBack) {
        for (const topic of thermostatTopics) {
          const reading = fresh(topic)
          if (!reading) {
            skipped.push(`${roomName(topic)}: no fresh reading, not set back`)
            continue
          }
          if (reading.mode !== 'heating') continue
          const setback = roundHalf(reading.targetTemp - setbackK)
          if (setback < roomMin) {
            skipped.push(`${roomName(topic)}: ${reading.targetTemp} is too low to set back`)
            continue
          }
          rooms[topic] = { home: reading.targetTemp, setback }
          lines.push(`${roomName(topic)}: ${reading.targetTemp} -> ${setback}`)
        }
        if (living == null) {
          skipped.push('living room: no set point seen, not set back')
        } else {
          const setback = Math.max(livingMin, roundHalf(living.setPoint - setbackK))
          if (setback < living.setPoint - 0.05) {
            livingPlan = { home: living.setPoint, setback }
            lines.push(`living room: ${living.setPoint} -> ${setback}`)
          }
        }
      } else {
        lines.push(`rooms not set back: the return is in under ${restoreLeadMs / DAY} days`)
      }

      const command = boilerCommand(returnAt)
      state.away = true
      state.rooms = rooms
      state.living = livingPlan
      state.roomsDone = Object.keys(rooms).length === 0 && livingPlan == null
      state.boiler = { before: boilerMode, set: command ? command.mode : null }
      for (const [topic, { setback }] of Object.entries(rooms)) writeAndWatch('room', topic, setback, rooms[topic].home)
      if (livingPlan) writeAndWatch('living', null, livingPlan.setback, livingPlan.home)
      if (command) mqtt.publish(boilerSetTopic, command)
      publishSwitch()

      lines.push(command
        ? `boiler: ${command.mode === 'vacation_until' ? `off until ${localText(command.until, timeZone)}` : 'off for 14 days'}`
        : 'boiler: not changed (the return is too near)')
      tell([
        `Away mode is on${state.returnDate ? `, back on ${state.returnDate}` : ', no return date'}.`,
        ...lines, ...skipped
      ])
    }

    const turnOff = () => {
      if (!state.away) {
        publishSwitch()
        return
      }
      finish('back')
    }

    // The return date changed while away: only the schedule moves.
    const reschedule = (returnAt) => {
      const lines = []
      if (state.boiler.set != null && boilerIsOurs()) {
        const command = boilerCommand(returnAt)
        if (command) {
          mqtt.publish(boilerSetTopic, command)
          state.boiler = { ...state.boiler, set: command.mode }
        } else {
          if (boilerMode !== 'automatic') mqtt.publish(boilerSetTopic, { mode: 'automatic' })
          state.boiler = { ...state.boiler, set: null }
          lines.push('boiler: automatic')
        }
      }
      tell([`Return date is now ${state.returnDate || 'empty'}.`, ...lines])
      tick()
    }

    const setReturnDate = (payload) => {
      const text = typeof payload?.value === 'string' ? payload.value.trim() : null
      if (text == null) {
        say('ignored a return date without a text value')
        return
      }
      const at = text === '' ? null : localMidnight(text, timeZone)
      const bad = text !== '' && (at == null || at <= now() || at - boilerLeadMs > now() + boilerMaxAheadMs)
      if (bad) {
        say(`refused the return date "${text}": it must be a date in the future, under 60 days ahead`)
        publishDate()
        return
      }
      if (text === state.returnDate) {
        publishDate()
        return
      }
      state.returnDate = text
      publishDate()
      if (state.away) reschedule(at)
    }

    const currentOf = ({ kind, topic }) => (kind === 'room' ? fresh(topic)?.targetTemp : living?.setPoint)
    const changedByHand = (pending) => {
      const current = currentOf(pending)
      return current != null && pending.before != null && !same(current, pending.value) && !same(current, pending.before)
    }

    // Checks the writes and the schedule against the wall clock
    const tick = () => {
      if (!isEnabled()) return
      const lines = []
      const keep = []
      for (const pending of state.pending) {
        if (now() < pending.deadline) {
          keep.push(pending)
        } else if (changedByHand(pending)) {
          lines.push(`${label(pending.kind, pending.topic)}: changed by hand to ${currentOf(pending)}, left as it is`)
        } else if (pending.tries < maxTries) {
          write(pending.kind, pending.topic, pending.value)
          keep.push({ ...pending, tries: pending.tries + 1, deadline: now() + verifyMs })
        } else {
          lines.push(`${label(pending.kind, pending.topic)}: ${pending.value} not confirmed after ${maxTries} writes`)
        }
      }
      state.pending = keep

      if (state.away) {
        const returnAt = returnMoment()
        if (!state.roomsDone && returnAt != null && now() >= returnAt - restoreLeadMs) {
          const restored = restoreRooms(false)
          if (restored.length > 0) tell(['Rooms put back.', ...restored])
        }
        if (returnAt != null && now() >= returnAt) finish('date')
      }
      if (lines.length > 0) tell(['A write was not confirmed.', ...lines])
    }

    for (const topic of thermostatTopics) {
      mqtt.subscribe(`${topic}/reading`, (payload) => {
        if (typeof payload?.mode !== 'string' || !isNumber(payload.targetTemp)) return
        readings.set(topic, {
          mode: payload.mode,
          targetTemp: payload.targetTemp,
          at: isNumber(payload._tz) ? payload._tz : now()
        })
        seen('room', topic, payload.targetTemp)
      })
    }
    mqtt.subscribe(livingRoomStatusTopic, (payload) => {
      if (!isNumber(payload?.setPoint)) return
      living = { setPoint: payload.setPoint }
      seen('living', null, payload.setPoint)
    })
    mqtt.subscribe(boilerStatusTopic, (payload) => {
      if (typeof payload?.mode === 'string') boilerMode = payload.mode
    })
    mqtt.subscribe(switchSetTopic, (payload) => {
      if (typeof payload?.state !== 'boolean') return
      if (payload.state) turnOn()
      else turnOff()
    })
    mqtt.subscribe(returnDateSetTopic, setReturnDate)

    publishSwitch()
    publishDate()
    setInterval(tick, checkMs).unref?.()
    tick()
  }
})

module.exports.localMidnight = localMidnight
