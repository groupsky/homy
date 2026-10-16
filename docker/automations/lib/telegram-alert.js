/**
 * Sends a message to Telegram through telegram-bridge, as `source`.
 *
 * Best effort: a failure is logged and never thrown, so the bot's own safe
 * state does not depend on the bridge or on the internet. Nothing is sent
 * while `isEnabled()` is false: a disabled bot gets no input, so it would
 * report it as missing.
 */
const defaultHttpPost = (url, body) => fetch(url, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(body),
})

module.exports = ({url = 'http://telegram-bridge:3000/webhook', httpPost = defaultHttpPost, isEnabled = () => true} = {}) =>
  async (source, message) => {
    if (!isEnabled()) return
    try {
      const res = await httpPost(url, {source, message})
      if (res && res.ok === false) {
        console.error(`[${source}] telegram-bridge refused the alert: HTTP ${res.status}`)
      }
    } catch (err) {
      console.error(`[${source}] failed to send the alert:`, err.message)
    }
  }
