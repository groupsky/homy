const { payloadPreview } = require('./payload-preview')

// The dry-switch reading arrives as a single bit field (`inputs`) produced by
// the mbsl32di driver in modbus-serial. These are the three input bits wired to
// DMX channels 1-3; a closed input drives its channel to half brightness.
const CHANNEL_INPUT_BITS = [32, 512, 2048]
const CHANNEL_LEVEL = 128

// The accepted range of `inputs`: a 32-bit word, whether the publisher rendered
// it signed (bit 31 set makes it negative) or unsigned.
const INPUTS_MIN = -2147483648
const INPUTS_MAX = 4294967295

/**
 * Builds the MQTT `message` listener that drives `universe` from dry-switch
 * readings. The channel state is kept across messages, so a message that cannot
 * be used leaves the lights as they were.
 *
 * Extracted from the client wiring so it can be tested without a broker or a
 * USB DMX interface.
 *
 * A payload that cannot be used is logged and dropped, never thrown: this
 * listener runs inside the mqtt client's stream - handlePublish emits `message`
 * from writable._write - so an exception escaping it becomes an unhandled
 * `error` event on that stream. This service's own `error` handler exits with
 * code 1, and `restart: unless-stopped` plus a retained bad payload makes that a
 * crash loop. See issue #1526.
 */
function createMessageHandler (universe) {
  // Slot 0 is the DMX start code and is never lit; the frame handed to the
  // universe is st.slice(1).
  const st = [0, 0, 0, 0]

  return function handleMessage (topic, message) {
    let payload
    try {
      payload = JSON.parse(message)
    } catch (err) {
      console.error('Failed to parse payload for topic', topic, `"${payloadPreview(message)}"`, err)
      return
    }

    // Valid JSON is not necessarily the reading this driver expects: `null` has
    // no properties to destructure, and a missing `inputs` would otherwise
    // silently blank every channel.
    //
    // `inputs` must be a 32-bit flag field, not merely a number.
    // `typeof === 'number'` admits Infinity, and `Infinity & bit` is 0 for every
    // bit - the exact silent blanking this guard exists to prevent. It also
    // admits fractional values, which the bitwise operators truncate, and values
    // outside the 32-bit range, which they wrap into a different reading.
    // `Number.isSafeInteger` closes Infinity and fractions; the range check
    // closes the rest.
    //
    // The field is *signed*: mbsl32di builds it as `data[1] << 16 | data[0]`, so
    // it is negative exactly when input bit 31 is closed - a legitimate reading
    // on a 32-input module, and one that is in use. Accept either sign and
    // normalise with `>>> 0` before the bit tests, as mqtt-influx's mbsl32di
    // converter does. See issue #1586.
    if (payload === null || typeof payload !== 'object' ||
        !Number.isSafeInteger(payload.inputs) ||
        payload.inputs < INPUTS_MIN || payload.inputs > INPUTS_MAX) {
      console.error('Ignoring payload without a 32-bit integer inputs field for topic', topic,
        `"${payloadPreview(message)}"`)
      return
    }

    const inputs = payload.inputs >>> 0
    CHANNEL_INPUT_BITS.forEach((bit, channel) => {
      st[channel + 1] = (inputs & bit) ? CHANNEL_LEVEL : 0
    })
    universe.set(st.slice(1))
    console.log(st)
  }
}

module.exports = { createMessageHandler, CHANNEL_INPUT_BITS, CHANNEL_LEVEL }
