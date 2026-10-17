const { watchInputAge, DEFAULT_MAX_INPUT_AGE_MS } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')
const { sharedBatch } = require('../lib/group-alerts')

const weekDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const FIELDS = ['power', 'mode', 'fanSetting', 'targetTemp']
// seenAt is saved to disk; once a minute is enough for a limit of hours
const SEEN_AT_STEP_MS = 60 * 1000

const same = (field, a, b) => field === 'targetTemp' ? Math.abs(a - b) < 0.05 : a === b

// A restarted unit starts its clock at Monday 00:00; one that restarts by
// itself may lose only the week day. bac002-sync-clock sets the clock right
// within a second, so this shows in the first reading only. Near midnight the
// unit's clock may be a minute off, so its week day is not checked then.
const clockWrong = ({ weekDay, hours, _tz }) => {
  if (weekDay == null) return false
  const time = new Date(_tz)
  const minuteOfDay = time.getHours() * 60 + time.getMinutes()
  if (minuteOfDay < 2 || minuteOfDay >= 24 * 60 - 2) return false
  if (weekDay !== weekDays[time.getDay()]) return true
  return weekDay === 'mon' && hours === 0 && time.getHours() !== 0
}

/**
 * Writes a BAC002 thermostat's wanted settings back after the unit restarts
 * (#1796). At a restart the unit loads the values last set on its own panel;
 * values written over Modbus, from Home Assistant or bots, are lost.
 *
 * - Wanted state: power, mode, fan and set point from every normal reading, so
 *   both Home Assistant and panel changes count. Power is stored only while
 *   every contact is fresh and closed, because bac002-toggle-power switches the
 *   unit off while one is open.
 * - Restart: no reading for `silenceMs`, or the unit's clock goes wrong.
 * - The unit reloads its saved values for about 24 s, so readings in the next
 *   `reloadMs` are not stored. The first reading after that gets one write with
 *   only the values that differ. Later changes are a person's and are stored.
 * - No write without stored state, or when it was last seen more than
 *   `maxStateAgeMs` before the restart. No power write unless every contact is
 *   fresh and closed.
 *
 * Not covered: a short mains dip that changes a setting without any of these
 * signals looks like a panel change, so the bot stores the new value.
 */
module.exports = (name, {
  bacTopic: topicPrefix,
  switches = [],
  silenceMs = 20 * 1000,
  reloadMs = 30 * 1000,
  maxStateAgeMs = 24 * 60 * 60 * 1000,
  maxInputAgeMs = DEFAULT_MAX_INPUT_AGE_MS,
  telegramWebhookUrl,
  httpPost
}) => ({
  persistedCache: {
    version: 1,
    default: {
      wanted: {},
      seenAt: null
    }
  },

  start: async ({ mqtt, persistedCache }) => {
    const writeTopic = `${topicPrefix}/write`
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost })
    // A power loss restarts every thermostat; one message lists them all.
    const restored = sharedBatch('bac002-restore-state:restored', {
      send: (lines) => alert('bac002-restore-state', `🔁 Thermostats restarted. Put back:\n${lines.join('\n')}`)
    })

    const contactOpen = switches.map(() => null)
    const contacts = watchInputAge({ inputs: switches.map((_, index) => index), maxAgeMs: maxInputAgeMs })
    const contactsClosed = () => contacts.isFresh() && contactOpen.every((open) => open === false)

    let lastReadingAt = null
    let clockWasWrong = false
    let restartAt = null
    let restoreAfter = null

    switches.forEach(({ topic, isOpen }, index) => {
      mqtt.subscribe(topic, (payload) => {
        contactOpen[index] = isOpen(payload)
        contacts.seen(index, payload._tz)
      })
    })

    const store = (payload) => {
      for (const field of FIELDS) {
        if (payload[field] == null) continue
        if (field === 'power' && !contactsClosed()) continue
        persistedCache.wanted[field] = payload[field]
      }
      if (persistedCache.seenAt == null || payload._tz - persistedCache.seenAt >= SEEN_AT_STEP_MS) {
        persistedCache.seenAt = payload._tz
      }
    }

    const restore = (payload) => {
      const { wanted, seenAt } = persistedCache
      if (seenAt == null || restartAt - seenAt > maxStateAgeMs) {
        console.log(`[${name}] not writing back: the stored state is ${seenAt == null ? 'missing' : `from ${new Date(seenAt).toISOString()}`}`)
        return
      }
      const write = {}
      for (const field of FIELDS) {
        if (wanted[field] == null || same(field, wanted[field], payload[field])) continue
        if (field === 'power' && !contactsClosed()) {
          console.log(`[${name}] not writing power ${wanted.power}: a contact is open or has no fresh data`)
          continue
        }
        write[field] = wanted[field]
      }
      if (Object.keys(write).length === 0) {
        console.log(`[${name}] after the restart every setting is as wanted`)
        return
      }
      console.log(`[${name}] writing back after the restart`, write)
      mqtt.publish(writeTopic, write)
      restored(`${name}: ${Object.entries(write).map(([field, value]) => `${field} ${value}`).join(', ')}`)
    }

    mqtt.subscribe(`${topicPrefix}/reading`, (payload) => {
      const at = payload._tz
      const silence = lastReadingAt != null && at - lastReadingAt > silenceMs
      const wrong = clockWrong(payload)
      const signal = silence ? `no reading for ${Math.round((at - lastReadingAt) / 1000)} s`
        : wrong && !clockWasWrong ? `clock at ${payload.weekDay} ${payload.hours}:${payload.minutes}`
          : null
      lastReadingAt = at
      clockWasWrong = wrong

      if (signal) {
        console.log(`[${name}] restart seen (${signal}), writing back the wanted state in ${reloadMs / 1000} s`)
        if (restoreAfter == null) restartAt = at
        restoreAfter = at + reloadMs
        return
      }
      if (restoreAfter != null) {
        if (at < restoreAfter) return
        restoreAfter = null
        restore(payload)
        return
      }
      store(payload)
    })
  }
})
