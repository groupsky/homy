// Delays between attempts to open the DMX adapter: 1 s, doubling, at most 60 s.
const DEFAULT_DELAYS = { initialMs: 1000, maxMs: 60000 }

/**
 * Wraps the DMX universe so that the adapter is opened in the background and
 * retried with backoff, instead of `new DMX()` throwing at module load and
 * crash-looping the service (issue #1547).
 *
 * `open()` creates the native universe and throws when the adapter cannot be
 * opened. `onState(state)` is told `{state: 'opening'|'online'|'offline',
 * error?, attempt}` so the caller can publish it.
 *
 * The returned object has the same `set(values)` as the native universe, so
 * the message handler does not know about the retry. While the adapter is not
 * open, the latest frame is kept and written as soon as it opens.
 */
function createUniverse ({ open, onState = () => {}, log = console, delays = DEFAULT_DELAYS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let device = null
  let lastFrame = null
  let attempt = 0
  let timer = null
  let stopped = false

  function tryOpen () {
    timer = null
    if (stopped) return
    attempt++
    try {
      const dmx = open()
      dmx.setHz(20)
      dmx.step(5)
      // set() also starts the native update thread.
      dmx.set(lastFrame || 0)
      device = dmx
      log.log(`DMX adapter opened on attempt ${attempt}`)
      onState({ state: 'online', attempt })
    } catch (err) {
      const delay = Math.min(delays.initialMs * 2 ** (attempt - 1), delays.maxMs)
      log.error(`Cannot open DMX adapter (attempt ${attempt}), retrying in ${delay} ms:`, err.message)
      onState({ state: 'offline', error: err.message, attempt })
      timer = setTimer(tryOpen, delay)
    }
  }

  return {
    start () {
      onState({ state: 'opening', attempt })
      tryOpen()
    },
    stop () {
      stopped = true
      if (timer) clearTimer(timer)
    },
    set (values) {
      lastFrame = values
      if (device) device.set(values)
    },
    isOpen () {
      return device !== null
    }
  }
}

module.exports = { createUniverse, DEFAULT_DELAYS }
