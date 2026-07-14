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

  return {
    persistedCache: {
      version: 1,
      default: { stored: [], pending: [], flaggedKey: '' }
    },

    start: async ({ mqtt, persistedCache }) => {
      const handle = (which) => (payload) => {
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
      }

      await mqtt.subscribe(storedTopic, handle('stored'))
      await mqtt.subscribe(pendingTopic, handle('pending'))
    }
  }
}
