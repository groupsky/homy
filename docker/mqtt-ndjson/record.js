const { payloadPreview } = require('./payload-preview')

// Ingest-timestamp keys stamped into every payload, the same two that
// docker/mqtt-mongo stamps: TZ_FIELD is epoch milliseconds, TS_FIELD the same
// instant as an ISO 8601 UTC string (mqtt-mongo stores it as a BSON Date, which
// is what that string is in JSON).
const TS_FIELD = '_ts'
const TZ_FIELD = '_tz'

// Keys of the wrapper built for a message that cannot be kept as an object
// (see buildRecord). RAW_FIELD holds the payload as it arrived; ERROR_FIELD
// says why it was wrapped.
const RAW_FIELD = '_raw'
const ERROR_FIELD = '_parseError'

// Characters of the raw payload kept in the wrapper. Generous next to real
// payloads (an Ioniq OBD frame is tens of bytes), and it keeps one rogue
// publish from writing a line of many megabytes. The same bound as
// docker/mqtt-mongo, so both archives keep the same text.
const RAW_LENGTH = 65536

// A non-null, non-array object: the only kind of value the timestamps can be
// added to. Assigning to a scalar is a silent no-op, and an array's extra
// properties are not serialized.
function isRecordableObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Builds the `{ topic, payload }` record for one MQTT message.
 *
 * Returns `{ record, error }`: `error` is `null`, or the reason the payload
 * could not be kept as it arrived. The reason is returned beside the record
 * rather than read back off it, because `_raw` and `_parseError` are ordinary
 * JSON keys any publisher can send.
 *
 * Both timestamps are only set when absent, so a producer that already stamped
 * them is preserved. `now` is injectable for deterministic tests.
 *
 * A payload that is not valid JSON, or is valid JSON but not an object, is
 * wrapped as `{ _raw, _parseError }` rather than dropped or thrown: this file
 * is the only record of the topics it covers, and a throw in the MQTT message
 * listener kills the process (issue #1526).
 */
function buildRecord(topic, message, now = new Date()) {
  let payload
  let error = null
  try {
    payload = JSON.parse(message)
    if (!isRecordableObject(payload)) {
      error = `payload is not a JSON object (${typeof payload})`
    }
  } catch (err) {
    error = err.message
  }
  if (error !== null) {
    payload = {
      [RAW_FIELD]: payloadPreview(message, RAW_LENGTH),
      [ERROR_FIELD]: error,
    }
  }
  if (!payload[TZ_FIELD]) {
    payload[TZ_FIELD] = now.getTime()
  }
  if (!payload[TS_FIELD]) {
    payload[TS_FIELD] = now.toISOString()
  }
  return { record: { topic, payload }, error }
}

module.exports = { buildRecord, TS_FIELD, TZ_FIELD, RAW_FIELD, ERROR_FIELD, RAW_LENGTH }
