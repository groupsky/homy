const telegramAlert = require('../lib/telegram-alert')

/**
 * Sends ev-journal's car notices to Telegram through telegram-bridge (#1954).
 *
 * - Listens on `topic` (QoS 1). Payload: {id, kind, time, text}.
 * - Posts `text` as source `ioniq-notices`. Quiet hours are telegram-bridge's.
 * - Drops a message whose `id` was already sent. The last `maxIds` ids are
 *   kept in the persisted cache, so a restart does not send them again.
 *   ev-journal sends each id once; this guards against MQTT redelivery.
 * - Drops a message with no `id` or no `text`, with one log line.
 */
module.exports = (name, {
  topic = 'homy/ioniq/notice',
  source = 'ioniq-notices',
  maxIds = 200,
  telegramWebhookUrl,
  httpPost
} = {}) => ({
  persistedCache: {
    version: 1,
    // Sent ids, oldest first
    default: { ids: [] },
    migrate: ({ state }) => {
      if (!Array.isArray(state.ids)) state.ids = []
      return state
    }
  },

  start: async ({ mqtt, persistedCache, isEnabled = () => true }) => {
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost, isEnabled })
    const isText = (value) => typeof value === 'string' && value.trim() !== ''

    await mqtt.subscribe(topic, async (payload) => {
      if (!payload || typeof payload !== 'object' || !isText(payload.id) || !isText(payload.text)) {
        console.log(`[${name}] dropped a notice without id or text`)
        return
      }
      if (persistedCache.ids.includes(payload.id)) return
      // Saved before the send: a notice is sent at most once, even when the
      // bridge call fails or the bot stops during it.
      persistedCache.ids = [...persistedCache.ids, payload.id].slice(-maxIds)
      await alert(source, payload.text)
    }, { qos: 1 })
  }
})
