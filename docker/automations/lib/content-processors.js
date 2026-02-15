/**
 * Content processors for MQTT message serialization
 *
 * Each processor handles read (deserialize) and write (serialize) operations
 * with optional metadata support.
 */

const contentProcessors = {
  /**
   * JSON content processor
   * - Reads: Parse JSON string to object
   * - Writes: Stringify object to JSON, merging in optional metadata
   */
  json: {
    read: (val) => JSON.parse(val),
    write: (val, meta = {}) => JSON.stringify({
      ...val,
      ...meta
    })
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
