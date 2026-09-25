// One JSON line per Telegram Bot API call, so a searchable history of what the
// household was told exists: the Bot API cannot list messages a bot has sent.
// The line carries the full text, never the bot token and never the chat id.

export const SENDER = 'telegram-bridge'
export const DEFAULT_SOURCE = 'grafana'
const MAX_SOURCE_LENGTH = 64

// `source` names what asked for the message; anything that is not a short
// non-empty string falls back to the default.
export function normalizeSource(source) {
  if (typeof source !== 'string') return DEFAULT_SOURCE
  const trimmed = source.trim()
  if (!trimmed || trimmed.length > MAX_SOURCE_LENGTH) return DEFAULT_SOURCE
  return trimmed
}

// Bot API errors arrive as a JSON body with a `description`; transport errors
// are plain messages. The token is stripped in case a URL ends up in one.
function describeError(result, botToken) {
  if (!result || result.success) return null
  let error = result.error
  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error)
      if (parsed && typeof parsed.description === 'string') error = parsed.description
    } catch {
      // not JSON: keep the raw text
    }
  } else if (result.data && typeof result.data.description === 'string') {
    error = result.data.description
  }
  error = error == null ? 'unknown error' : String(error)
  return botToken ? error.split(botToken).join('[redacted]') : error
}

export function buildSentLine({ text, source, result, botToken }) {
  const ok = Boolean(result && result.success)
  const messageId = ok && result.data && result.data.result ? result.data.result.message_id ?? null : null
  return JSON.stringify({
    event: 'telegram.sent',
    sender: SENDER,
    source: normalizeSource(source),
    origin_host: 'routy',
    ok,
    message_id: messageId,
    error: describeError(result, botToken),
    text,
  })
}

export function logSent(fields) {
  console.log(buildSentLine(fields))
}
