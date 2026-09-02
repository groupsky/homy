/**
 * Truncated, log-safe rendering of an MQTT payload.
 *
 * Payloads that fail to parse are the ones worth logging, and they are exactly
 * the ones that may be arbitrarily long or binary. A bounded preview keeps a
 * malformed publisher from flooding the log while still showing enough of the
 * payload to identify it.
 */

/** Characters of the payload kept in a log line. */
const PREVIEW_LENGTH = 100

/**
 * Renders `value` as at most `maxLength` characters, marking any truncation.
 *
 * Never throws: it is called from error paths, where a second failure would
 * hide the first.
 */
function payloadPreview (value, maxLength = PREVIEW_LENGTH) {
  let text
  try {
    text = String(value)
  } catch (err) {
    return '<unprintable payload>'
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}... (${text.length} chars)` : text
}

module.exports = { payloadPreview, PREVIEW_LENGTH }
