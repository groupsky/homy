/**
 * Door Alarm Bot
 *
 * Monitors a door sensor and triggers escalating alarms when the door is left open.
 * Supports configurable escalation steps with different delays, durations, and volumes.
 */

module.exports = (name, config) => {
  const {
    doorSensor,
    alarmDevice,
    escalationSteps,
    melody = 10,
    verbose = false
  } = config

  const log = (...args) => {
    if (verbose) {
      console.log(`[${name}]`, ...args)
    }
  }

  return {
    start: async ({ mqtt }) => {
      let timers = []
      let isDoorOpen = false

      const clearAllTimers = () => {
        timers.forEach(timer => clearTimeout(timer))
        timers = []
      }

      const scheduleAlarms = () => {
        clearAllTimers()

        escalationSteps.forEach((step, index) => {
          const timer = setTimeout(() => {
            const alarmPayload = {
              alarm: 'ON',
              volume: step.volume,
              duration: step.durationSec,
              melody
            }

            log(`triggering alarm - step ${index + 1}:`, step)
            mqtt.publish(alarmDevice.commandTopic, alarmPayload)
          }, step.delayMs)

          timers.push(timer)
        })
      }

      await mqtt.subscribe(doorSensor.statusTopic, (payload) => {
        const doorOpen = payload.state

        if (doorOpen && !isDoorOpen) {
          log('door opened, scheduling alarms')
          isDoorOpen = true
          scheduleAlarms()
        } else if (!doorOpen && isDoorOpen) {
          log('door closed, cancelling alarms')
          isDoorOpen = false
          clearAllTimers()
        }
      })
    }
  }
}
