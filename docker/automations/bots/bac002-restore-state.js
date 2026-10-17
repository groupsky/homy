const { watchInputAge, DEFAULT_MAX_INPUT_AGE_MS } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')
const { sharedBatch } = require('../lib/group-alerts')

const weekDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
// The values the driver accepts for each field the bot keeps
const VALUES = {
  power: ['off', 'on'],
  mode: ['cooling', 'heating', 'ventilation'],
  fanSetting: ['auto', 'high', 'mid', 'low'],
}
const FIELDS = ['power', 'mode', 'fanSetting', 'targetTemp']
// seenAt is saved to disk; once a minute is enough for a limit of hours
const SEEN_AT_STEP_MS = 60 * 1000

const valid = (field, value) => field === 'targetTemp'
  ? typeof value === 'number' && value >= 5 && value <= 35
  : VALUES[field].includes(value)
const same = (field, a, b) => field === 'targetTemp' ? Math.abs(a - b) < 0.05 : a === b

// A restarted unit starts its clock at Monday 00:00; one that restarts by
// itself may lose only the week day. bac002-sync-clock sets the clock right
// within a second, so this shows in the first reading only. The unit's clock
// may be a minute off, so near midnight its week day is not checked (null:
// unknown), and on a Monday 00:xx counts only from 01:02.
const clockWrong = ({ weekDay, hours, _tz }) => {
  if (weekDay == null) return null
  const time = new Date(_tz)
  const minuteOfDay = time.getHours() * 60 + time.getMinutes()
  if (minuteOfDay < 2 || minuteOfDay >= 24 * 60 - 2) return null
  if (weekDay !== weekDays[time.getDay()]) return true
  return weekDay === 'mon' && hours === 0 && minuteOfDay >= 62
}

// Minutes since Monday 00:00 on the unit's clock: its uptime, if it restarted
const unitMinutes = ({ weekDay, hours, minutes }) =>
  ((weekDays.indexOf(weekDay) + 6) % 7) * 24 * 60 + hours * 60 + minutes

// A reset clock counts from 00:00; one that kept running shows the time of day
const timeOfDayWrong = ({ hours, minutes, _tz }) => {
  const time = new Date(_tz)
  const diff = Math.abs(hours * 60 + minutes - (time.getHours() * 60 + time.getMinutes()))
  return Math.min(diff, 24 * 60 - diff) > 2
}

/**
 * Writes a BAC002 thermostat's wanted settings back after the unit restarts
 * (#1796). At a restart the unit loads the values last set on its own panel;
 * values written over Modbus, from Home Assistant or bots, are lost.
 *
 * - Wanted state: power, mode, fan and set point from every normal reading, so
 *   both Home Assistant and panel changes count. Power is stored only while
 *   every contact is fresh and closed, because bac002-toggle-power switches the
 *   unit off while one is open, and the reading right after a contact closes
 *   may still show the contact bot's "off".
 * - Restart: no reading for `silenceMs` up to `maxSilenceMs`, or the unit's
 *   clock goes wrong. A longer gap is the reader, the broker or this bot being
 *   down, when a person may have used the panel; a power loss that long resets
 *   the unit's clock, which the clock check sees.
 * - The unit reloads its saved values for about 24 s, so readings in the next
 *   `reloadMs` are not stored. The first reading after that gets one write with
 *   only the values that differ. Readings in the next `reloadMs` are not stored
 *   either; a field that still differs and still shows its value from the
 *   first write is written once more. Later changes are a person's and are
 *   stored.
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
  silenceMs = 15 * 1000,
  maxSilenceMs = 2 * 60 * 1000,
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
    let closedBefore = false
    let restartAt = null
    let restoreAfter = null
    // After the first write: the value the unit showed for each field then
    let written = null

    switches.forEach(({ topic, isOpen }, index) => {
      mqtt.subscribe(topic, (payload) => {
        contactOpen[index] = isOpen(payload)
        contacts.seen(index, payload._tz)
      })
    })

    const store = (payload, powerIsWanted) => {
      for (const field of FIELDS) {
        if (!valid(field, payload[field])) continue
        if (field === 'power' && !powerIsWanted) continue
        persistedCache.wanted[field] = payload[field]
      }
      if (persistedCache.seenAt == null || payload._tz - persistedCache.seenAt >= SEEN_AT_STEP_MS) {
        persistedCache.seenAt = payload._tz
      }
    }

    const restore = (payload) => {
      restoreAfter = null
      const { wanted, seenAt } = persistedCache
      if (seenAt == null || restartAt - seenAt > maxStateAgeMs) {
        console.log(`[${name}] not writing back: the stored state is ${seenAt == null ? 'missing' : `from ${new Date(seenAt).toISOString()}`}`)
        return
      }
      const again = written != null
      const write = {}
      for (const field of FIELDS) {
        if (wanted[field] == null || same(field, wanted[field], payload[field])) continue
        // The second time, a new value is a person's change: write only the
        // fields that still show the value they had at the first write.
        if (again && !same(field, written[field], payload[field])) continue
        if (field === 'power' && !contactsClosed()) {
          console.log(`[${name}] not writing power ${wanted.power}: a contact is open or has no fresh data`)
          continue
        }
        write[field] = wanted[field]
      }
      written = null
      if (Object.keys(write).length === 0) {
        console.log(`[${name}] nothing to write back after the restart`)
        return
      }
      console.log(`[${name}] writing back after the restart${again ? ', again' : ''}`, write)
      mqtt.publish(writeTopic, write)
      restored(`${name}: ${Object.entries(write).map(([field, value]) => `${field} ${value}`).join(', ')}${again ? ' (again)' : ''}`)
      if (again) return
      // Check after another reload time that the unit took it
      written = Object.fromEntries(FIELDS.map((field) => [field, payload[field]]))
      restoreAfter = payload._tz + reloadMs
    }

    mqtt.subscribe(`${topicPrefix}/reading`, (payload) => {
      const at = payload._tz
      const gap = lastReadingAt == null ? 0 : at - lastReadingAt
      const wrong = clockWrong(payload)
      // A unit whose clock is still wrong from a restart shows no clock change
      // when it restarts again in a reader outage; its clock then shows less
      // time since Monday 00:00 than the outage lasted.
      const restartedInGap = gap > maxSilenceMs && timeOfDayWrong(payload) &&
        (unitMinutes(payload) + 2) * 60 * 1000 < gap
      const signal = gap > silenceMs && gap <= maxSilenceMs ? `no reading for ${Math.round(gap / 1000)} s`
        : wrong && (!clockWasWrong || restartedInGap) ? `clock at ${payload.weekDay} ${payload.hours}:${String(payload.minutes).padStart(2, '0')}`
          : null
      lastReadingAt = at
      if (wrong != null) clockWasWrong = wrong
      const closed = contactsClosed()
      const powerIsWanted = closed && closedBefore
      closedBefore = closed

      // A longer gap may hide a person's change at the panel, so a write-back
      // still waiting from before it is dropped.
      if (gap > maxSilenceMs && restoreAfter != null) {
        console.log(`[${name}] no reading for ${Math.round(gap / 1000)} s, dropping the waiting write-back`)
        restoreAfter = null
        written = null
      }
      if (signal) {
        console.log(`[${name}] restart seen (${signal}), writing back the wanted state in ${reloadMs / 1000} s`)
        // A restart while a write-back waits starts it over; the age check
        // stays with the first one.
        if (restoreAfter == null) restartAt = at
        written = null
        restoreAfter = at + reloadMs
        return
      }
      if (restoreAfter != null) {
        if (at >= restoreAfter) restore(payload)
        return
      }
      store(payload, powerIsWanted)
    })
  }
})
