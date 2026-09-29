const { buildRecord } = require('./record')
const { payloadPreview } = require('./payload-preview')
const { utcDay } = require('./day-file-writer')

// How far a producer's own `_tz` may be from the arrival time and still pick
// the file. Beyond it the record is filed by arrival time (and kept as sent).
//
// This deliberately narrows issue #1622's rule "day = the UTC day of `_tz`":
// a `_tz` in seconds instead of milliseconds, or an old retained message
// replayed on reconnect, would otherwise append to a day the host-side job has
// already archived (or to 1970). 36 hours covers any real delay; the messages
// this service stamps itself are always within it.
const MAX_PRODUCER_SKEW_MS = 36 * 60 * 60 * 1000

/**
 * Writes every message the MQTT client receives as one `{ topic, payload }`
 * line through `writer` (a day-file-writer).
 *
 * The line goes to the file of the UTC day of `payload._tz`: the time this
 * service received it, or the `_tz` the producer stamped itself (automations
 * bots do). A producer's `_tz` that is not epoch milliseconds, or is more than
 * MAX_PRODUCER_SKEW_MS from the arrival time, does not pick the file: the
 * record is kept as sent and filed by the time it arrived.
 *
 * Nothing may throw out of this listener: it runs inside the mqtt client's
 * stream, where an exception becomes an unhandled `error` event and kills the
 * process (issue #1526).
 *
 * - A payload that is not valid JSON is written raw (see record.js) and logged
 *   with a bounded preview.
 * - A write failure is logged and made an explicit `exit(1)`, as in
 *   docker/mqtt-mongo, so the container restarts and tries again.
 */
function startWriting({ client, writer, now = () => new Date(), exit = (code) => process.exit(code) }) {
  client.on('message', function (topic, message) {
    const receivedAt = now()
    let built
    try {
      built = buildRecord(topic, message, receivedAt)
    } catch (err) {
      // buildRecord is written not to throw; this makes the guarantee
      // structural. Losing one message beats losing the writer.
      console.error('Failed to build record for topic', topic,
        `"${payloadPreview(message)}"`, err)
      return
    }
    if (built.error) {
      console.error('Failed to parse payload for topic', topic,
        `"${payloadPreview(message)}"`, built.error, '- writing raw')
    }
    const timestamp = fileTimestamp(built.record.payload._tz, receivedAt.getTime())
    try {
      writer.write(built.record, timestamp)
    } catch (err) {
      console.error('Failure writing record for topic', topic, err)
      exit(1)
    }
  })
}

// The timestamp whose UTC day picks the file: the record's `_tz` if it is
// epoch milliseconds close enough to the arrival time, else the arrival time.
function fileTimestamp(stamped, arrived) {
  const trusted = utcDay(stamped) !== null && Math.abs(stamped - arrived) <= MAX_PRODUCER_SKEW_MS
  return trusted ? stamped : arrived
}

module.exports = { startWriting, MAX_PRODUCER_SKEW_MS }
