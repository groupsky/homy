/**
 * Sends a message to Telegram through telegram-bridge, as `source`.
 *
 * Best effort: a failure is logged and never thrown, so the bot's own safe
 * state does not depend on the bridge or on the internet.
 */
const defaultHttpPost = (url, body) => fetch(url, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(body),
})

module.exports = ({url = 'http://telegram-bridge:3000/webhook', httpPost = defaultHttpPost} = {}) =>
  async (source, message) => {
    try {
      const res = await httpPost(url, {source, message})
      if (res && res.ok === false) {
        console.error(`[${source}] telegram-bridge refused the alert: HTTP ${res.status}`)
      }
    } catch (err) {
      console.error(`[${source}] failed to send the alert:`, err.message)
    }
  }
