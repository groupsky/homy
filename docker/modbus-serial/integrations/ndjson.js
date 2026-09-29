const { createDayFileWriter } = require('../day-file-writer')

/**
 * Writes every reading, as one JSON line, to a daily NDJSON file:
 *
 *     <root>/<stream>/<YYYY-MM-DD>.<service>.ndjson
 *
 * `stream` is the Mongo collection the same readings go to, `service` the
 * compose service name, and the day is the UTC day of the reading's `_tz`.
 * These files replace the raw readings in MongoDB (issue #1622); a host-side
 * job turns finished days into Parquet.
 *
 * The line has the same fields as the Mongo document, without `_id`. index.js
 * hands the same object to every integration, and the mongodb integration's
 * `insertOne` adds `_id` to it, so `_id` is dropped here explicitly, whatever
 * order the integrations run in. The shared object itself is not changed.
 *
 * At startup the stream directory must be writable, or this throws and the
 * service exits: a raw directory docker created as root would otherwise make
 * every write fail while the service looks healthy.
 *
 * A failed write after that is logged and the reading is skipped: it must not
 * stop the other integrations or the bus reader. The same error is logged only
 * once, not for every reading, and a recovery is logged too. The writer
 * repairs a cut line on the next write (see day-file-writer.js).
 */
module.exports = ({ root, stream, service }) => {
  const writer = createDayFileWriter({ root, stream, service })
  writer.ensureWritable()

  // Message of the error being reported, or null while writes succeed.
  let failing = null

  const logger = (entry) => {
    // eslint-disable-next-line no-unused-vars
    const { _id, ...record } = entry
    try {
      writer.write(record, record._tz)
    } catch (err) {
      if (err.message !== failing) {
        failing = err.message
        console.error(`[ndjson] failed to write a reading of ${record.device} to ${stream}; further identical errors are not logged`, err)
      }
      return
    }
    if (failing !== null) {
      failing = null
      console.log(`[ndjson] writing to ${stream} works again`)
    }
  }

  logger.toString = () => 'ndjson'

  return { publish: logger }
}
