const { watchInputAge, DEFAULT_MAX_INPUT_AGE_MS } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')

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

  start: async ({ mqtt, persistedCache }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost })
    const minutes = Math.round(maxInputAgeMs / 60000)

    // A contact reader that stops leaves its last state here. Acting on it
    // could keep a room off that nobody can turn on (#1743), so the bot only
    // switches while every contact reported within maxInputAgeMs.
    const contacts = watchInputAge({
      inputs: switches.map((_, index) => index),
      maxAgeMs: maxInputAgeMs,
      onChange: (stale) => alert(name, stale
        ? `⚠️ ${name}: no contact data for ${minutes} min. The thermostat is not switched until it returns.`
        : `✅ ${name}: contact data is back. The thermostat is switched again.`)
    })

    switches.forEach(({topic, isOpen}, index) => {
      mqtt.subscribe(topic, (payload) => {
        persistedCache.switchStates[index] = isOpen(payload)
        contacts.seen(index)
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
