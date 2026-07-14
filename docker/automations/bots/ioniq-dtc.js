// ioniq-dtc: reduces the Ioniq DTC arrays (stored + pending) to a numeric
// derived/dtc_count signal for Grafana, and direct-flags newly-appeared codes
// to Telegram via telegram-bridge.
async function defaultHttpPost (url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

// Escape the few characters that would corrupt a telegram-bridge HTML message
// (parse_mode: HTML). DTC codes are normally alphanumeric, but a malformed code
// must never break the message and silently suppress a critical alert.
function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// The logger publishes `codes` as a JSON array; tolerate a JSON-string form too
// so a delivery quirk can't silently zero out the whole feature.
function parseCodes (raw) {
  let codes = raw
  if (typeof codes === 'string') {
    try {
      codes = JSON.parse(codes)
    } catch (err) {
      codes = []
    }
  }
  return Array.isArray(codes) ? codes : []
}

module.exports = function createIoniqDtc (name, config) {
  const storedTopic = config.storedTopic || 'ioniq/parsed/dtc/stored'
  const pendingTopic = config.pendingTopic || 'ioniq/parsed/dtc/pending'
  const outputTopic = config.outputTopic || 'ioniq/parsed/derived/dtc_count'
  const telegramWebhookUrl = config.telegramWebhookUrl || 'http://telegram-bridge:3000/webhook'
  const flagOnEdge = config.flagOnEdge !== false
  const httpPost = config.httpPost || defaultHttpPost
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  return {
    persistedCache: {
      version: 1,
      // `flagged` is the set of codes already direct-flagged in the current
      // fault episode; it resets only when all codes clear (union empty).
      default: { stored: [], pending: [], flagged: [] }
    },

    start: async ({ mqtt, persistedCache }) => {
      const handle = (which) => async (payload) => {
        persistedCache[which] = parseCodes(payload && payload.codes)

        const union = [...new Set([...persistedCache.stored, ...persistedCache.pending])]
        mqtt.publish(outputTopic, {
          _type: 'ioniq',
          group: 'derived/dtc_count',
          state: payload && payload.state,
          ts: payload && payload.ts,
          value: union.length,
          codes: union
        })

        // All codes cleared: reset so a genuinely new episode flags again.
        if (union.length === 0) {
          persistedCache.flagged = []
          return
        }

        // Flag only codes not already flagged this episode — never on removal,
        // and never re-nag a code that merely persists or reappears while
        // other codes remain present.
        const flaggedSet = new Set(persistedCache.flagged)
        const newCodes = union.filter((code) => !flaggedSet.has(code))
        persistedCache.flagged = [...new Set([...persistedCache.flagged, ...union])]

        if (flagOnEdge && newCodes.length > 0) {
          const parts = newCodes.map((code) =>
            `${escapeHtml(code)} (${persistedCache.stored.includes(code) ? 'stored' : 'pending'})`)
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
