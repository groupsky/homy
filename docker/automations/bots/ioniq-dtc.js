// ioniq-dtc: reduces the Ioniq DTC arrays (stored + pending) to a numeric
// derived/dtc_count signal for Grafana, and (Task 2) direct-flags new codes to Telegram.
async function defaultHttpPost (url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

module.exports = function createIoniqDtc (name, config) {
  const storedTopic = config.storedTopic || 'ioniq/parsed/dtc/stored'
  const pendingTopic = config.pendingTopic || 'ioniq/parsed/dtc/pending'
  const outputTopic = config.outputTopic || 'ioniq/parsed/derived/dtc_count'
  const telegramWebhookUrl = config.telegramWebhookUrl || 'http://telegram-bridge:3000/webhook'
  const flagOnEdge = config.flagOnEdge !== false
  const httpPost = config.httpPost || defaultHttpPost
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  const keyOf = (codes) => codes.slice().sort().join(',')

  return {
    persistedCache: {
      version: 1,
      default: { stored: [], pending: [], flaggedKey: '' }
    },

    start: async ({ mqtt, persistedCache }) => {
      const handle = (which) => async (payload) => {
        const codes = Array.isArray(payload && payload.codes) ? payload.codes : []
        persistedCache[which] = codes

        const union = [...new Set([...persistedCache.stored, ...persistedCache.pending])]
        mqtt.publish(outputTopic, {
          _type: 'ioniq',
          group: 'derived/dtc_count',
          state: payload && payload.state,
          ts: payload && payload.ts,
          value: union.length,
          codes: union
        })

        if (union.length === 0) {
          persistedCache.flaggedKey = ''
          return
        }

        const key = keyOf(union)
        if (flagOnEdge && key !== persistedCache.flaggedKey) {
          persistedCache.flaggedKey = key
          const parts = union.map((code) =>
            `${code} (${persistedCache.stored.includes(code) ? 'stored' : 'pending'})`)
          const message = `🚗 <b>DTC present</b>: ${parts.join(', ')}`
          try {
            await httpPost(telegramWebhookUrl, { message })
          } catch (err) {
            log('direct-flag POST failed:', err && err.message)
          }
        }
      }

      await mqtt.subscribe(storedTopic, handle('stored'))
      await mqtt.subscribe(pendingTopic, handle('pending'))
    }
  }
}
