const { buildRecord } = require('./record')
const { payloadPreview } = require('./payload-preview')
const { utcDay } = require('./day-file-writer')

/**
 * Writes every message the MQTT client receives as one `{ topic, payload }`
 * line through `writer` (a day-file-writer).
 *
 * The line goes to the file of the UTC day of `payload._tz`: the time this
 * service received it, or the `_tz` the producer stamped itself (automations
 * bots do). If the producer's `_tz` is not a timestamp, the record is kept as
 * sent and filed by the time it arrived.
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
    const stamped = built.record.payload._tz
    const timestamp = utcDay(stamped) !== null ? stamped : receivedAt.getTime()
    try {
      writer.write(built.record, timestamp)
    } catch (err) {
      console.error('Failure writing record for topic', topic, err)
      exit(1)
    }
  })
}

module.exports = { startWriting }
