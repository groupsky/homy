const { watchInputAge, DEFAULT_MAX_INPUT_AGE_MS } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')
const { sharedBatch } = require('../lib/group-alerts')

module.exports = (name, {
  bacTopic: topicPrefix,
  switches,
  maxInputAgeMs = DEFAULT_MAX_INPUT_AGE_MS,
  telegramWebhookUrl,
  httpPost
}) => ({
  persistedCache: {
    version: 1,
    default: {
      switchStates: new Array(switches.length).fill(false),
      wasOn: false
    }
  },

  start: async ({ mqtt, persistedCache, isEnabled }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost })
    const minutes = Math.round(maxInputAgeMs / 60000)
    // All thermostat bots read the same contact reader, so one outage is one
    // message that lists the rooms, not one message per room. The batch sends
    // with the first bot's bridge settings; all bots use the defaults.
    const staleRooms = sharedBatch('bac002-toggle-power:stale', {
      send: (names) => alert('bac002-toggle-power', `⚠️ No contact data for ${minutes} min: ${names.join(', ')}. These thermostats are not switched until it returns.`)
    })
    const backRooms = sharedBatch('bac002-toggle-power:back', {
      send: (names) => alert('bac002-toggle-power', `✅ Contact data is back: ${names.join(', ')}. These thermostats are switched again.`)
    })

    // A contact reader that stops leaves its last state here. Acting on it
    // could keep a room off that nobody can turn on (#1743), so the bot only
    // switches while every contact reported within maxInputAgeMs.
    const contacts = watchInputAge({
      inputs: switches.map((_, index) => index),
      maxAgeMs: maxInputAgeMs,
      onChange: (stale) => {
        // A disabled bot gets no input, so it would report it as missing.
        if (isEnabled && !isEnabled()) return
        (stale ? staleRooms : backRooms)(name)
      }
    })

    switches.forEach(({topic, isOpen}, index) => {
      mqtt.subscribe(topic, (payload) => {
        persistedCache.switchStates[index] = isOpen(payload)
        contacts.seen(index, payload._tz)
      })
    })

    mqtt.subscribe(readingTopic, (payload) => {
      if (!contacts.isFresh()) return

      const allClosed = persistedCache.switchStates.every(open => !open)

      if (payload.power === 'on' && !allClosed) {
        mqtt.publish(writeTopic, { power: 'off' })
        persistedCache.wasOn = true
      } else if (persistedCache.wasOn && payload.power === 'off' && allClosed) {
        mqtt.publish(writeTopic, { power: 'on' })
        persistedCache.wasOn = false
      }
    })
  }
})
