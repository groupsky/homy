/**
 * Content processors for MQTT message serialization
 *
 * Each processor handles read (deserialize) and write (serialize) operations
 * with optional metadata support.
 */

const { payloadPreview } = require('./payload-preview')

const contentProcessors = {
  /**
   * JSON content processor
   * - Reads: Parse JSON string to object
   * - Writes: Stringify object to JSON, merging in optional metadata
   *
   * Both directions still throw on bad input - a payload that cannot be
   * represented is a real failure and callers must decide what to do about it.
   * What they add is context: the bare `SyntaxError: Unexpected token o in JSON
   * at position 1` from `JSON.parse` names neither the payload nor its shape,
   * which is useless when the publisher is a device on the other side of the
   * broker. See issue #1224.
   */
  json: {
    read: (val) => {
      try {
        return JSON.parse(val)
      } catch (err) {
        // `cause` keeps the raw SyntaxError reachable, so a caller that already
        // logs its own preview can report the reason without repeating it.
        throw new Error(`Invalid JSON payload "${payloadPreview(val)}": ${err.message}`, { cause: err })
      }
    },
    write: (val, meta = {}) => {
      try {
        return JSON.stringify({
          ...val,
          ...meta
        })
      } catch (err) {
        // Circular structures and BigInt values reach here.
        throw new Error(`Payload cannot be serialized to JSON: ${err.message}`, { cause: err })
      }
    }
  },

  /**
   * Plain content processor
   * - Reads: Convert to string
   * - Writes: Convert to string, ignoring metadata
   *
   * Use for raw string payloads (e.g., IR codes, plain text)
   * where metadata should not be included.
   */
  plain: {
    read: (val) => String(val),
    write: (val, meta = {}) => String(val)  // Metadata intentionally ignored
  }
}

module.exports = contentProcessors
