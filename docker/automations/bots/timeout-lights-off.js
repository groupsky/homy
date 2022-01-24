const ARD_OUTPUT_TOPIC = '/homy/ard1/output'
const ARD_INPUT_TOPIC = '/homy/ard1/input'

module.exports = (name, {
  lockedTopic,
  lockedDi,
  lockedValue = true,
  timeout, unlockTimeout = timeout,
  pin
}) => ({
  start: ({ mqtt }) => {
    let locked = null
    let timer = null
    let light = null

    const emit = () => {
      mqtt.publish(ARD_OUTPUT_TOPIC, { pin, value: 0 })
    }

    const stopTimer = () => {
      if (timer == null) return
      clearTimeout(timer)
      timer = null
    }

    const startTimer = (ms) => {
      // cancel prev time if any
      stopTimer()

      // bail if locked or unknown
      if (locked == null || locked) return
      // no need to do anything if already off
      if (!light) return
      // schedule the timer
      timer = setTimeout(emit, ms)
    }

    // listen for the locked state change
    mqtt.subscribe(lockedTopic, (payload) => {
      const newLocked = Boolean(payload.inputs & (1 << lockedDi)) === lockedValue
      const oldLocked = locked
      locked = newLocked
      if (!newLocked && oldLocked) {
        startTimer(unlockTimeout)
      } else if (newLocked) {
        stopTimer()
      }
    })

    // listen for light changes
    mqtt.subscribe(ARD_INPUT_TOPIC, (payload) => {
      if (payload.t !== 'oc' || payload.p !== pin) return
      const newLight = payload.v === 0
      const oldLight = light

      light = newLight

      if (newLight) {
        startTimer(timeout)
      } else {
        stopTimer()
      }
    })
  }
})
