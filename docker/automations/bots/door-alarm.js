/**
 * Door Alarm Bot
 *
 * Monitors a door sensor and triggers escalating alarms when the door is left open.
 * Supports configurable escalation steps with different delays, durations, and volumes.
 * Includes state persistence for timer restoration after service restarts.
 */

module.exports = (name, config) => {
  const {
    doorSensor,
    alarmDevice,
    escalationSteps,
    melody = 10,
    verbose = false
  } = config

  // Configuration validation
  if (!doorSensor?.statusTopic) {
    throw new Error(`[${name}] doorSensor.statusTopic is required`)
  }
  if (!alarmDevice?.commandTopic) {
    throw new Error(`[${name}] alarmDevice.commandTopic is required`)
  }
  if (!escalationSteps || !Array.isArray(escalationSteps) || escalationSteps.length === 0) {
    throw new Error(`[${name}] escalationSteps must be a non-empty array`)
  }

  // Validate each escalation step
  escalationSteps.forEach((step, index) => {
    if (typeof step.delayMs !== 'number' || step.delayMs < 0) {
      throw new Error(`[${name}] escalationSteps[${index}].delayMs must be a positive number`)
    }
    if (typeof step.durationSec !== 'number' || step.durationSec < 0) {
      throw new Error(`[${name}] escalationSteps[${index}].durationSec must be a positive number`)
    }
    if (!['low', 'medium', 'high'].includes(step.volume)) {
      throw new Error(`[${name}] escalationSteps[${index}].volume must be 'low', 'medium', or 'high'`)
    }
  })

  const log = (...args) => {
    if (verbose) {
      console.log(`[${name}]`, ...args)
    }
  }

  return {
    persistedCache: {
      version: 1,
      default: {
        doorState: null,  // null = unknown, true = open, false = closed
        doorOpenTime: null,  // Timestamp when door opened
        pendingAlarms: []  // Array of {stepIndex, scheduledTime, triggered}
      },
      migrate: ({ version, defaultState, state }) => {
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      let timers = []
      let doorState = persistedCache.doorState

      // Defensive: an "open" without an open-time is an inconsistent persisted
      // state that the normal open/close paths never produce. Treat it as
      // unknown so the next live reading is handled as a fresh transition
      // instead of being silently deduplicated (which would never re-arm).
      if (doorState === true && persistedCache.doorOpenTime == null) {
        doorState = null
      }

      const clearAllTimers = () => {
        timers.forEach(timer => clearTimeout(timer))
        timers = []
      }

      const scheduleAlarms = () => {
        clearAllTimers()

        const now = Date.now()
        persistedCache.doorOpenTime = now
        persistedCache.pendingAlarms = []

        escalationSteps.forEach((step, index) => {
          const scheduledTime = now + step.delayMs

          persistedCache.pendingAlarms.push({
            stepIndex: index,
            scheduledTime,
            triggered: false
          })

          const timer = setTimeout(async () => {
            const alarmPayload = {
              alarm: true,
              volume: step.volume,
              duration: step.durationSec,
              melody
            }

            log(`triggering alarm - step ${index + 1}:`, step)

            try {
              await mqtt.publish(alarmDevice.commandTopic, alarmPayload)

              // Mark alarm as triggered in persisted state
              const alarm = persistedCache.pendingAlarms.find(a => a.stepIndex === index)
              if (alarm) {
                alarm.triggered = true
              }
            } catch (error) {
              log(`failed to publish alarm - step ${index + 1}:`, error.message)
            }
          }, step.delayMs)

          timers.push(timer)
        })
      }

      const cancelAlarms = async () => {
        clearAllTimers()
        persistedCache.doorOpenTime = null
        persistedCache.pendingAlarms = []

        // Stop any currently sounding alarm
        try {
          await mqtt.publish(alarmDevice.commandTopic, { alarm: false })
          log('stopped alarm on door close')
        } catch (error) {
          log('failed to stop alarm on door close:', error.message)
        }
      }

      // Re-arm escalation timers from persisted state, relative to the
      // original door-open time. Steps whose scheduled time has already passed
      // fire immediately. Invoked ONLY after a live sensor reading confirms the
      // door is still open (see restart confirmation in the handler below).
      const restorePendingAlarms = () => {
        const elapsed = Date.now() - persistedCache.doorOpenTime
        log(`resuming escalation, door has been open for ${elapsed/60000} minutes`)

        persistedCache.pendingAlarms.forEach((alarm) => {
          if (alarm.triggered) {
            return  // Already triggered, skip
          }

          const remaining = alarm.scheduledTime - Date.now()
          const step = escalationSteps[alarm.stepIndex]

          if (remaining > 0) {
            // Timer hasn't fired yet, restore it
            log(`restoring alarm step ${alarm.stepIndex + 1} with ${remaining/1000}s remaining`)

            const timer = setTimeout(async () => {
              const alarmPayload = {
                alarm: true,
                volume: step.volume,
                duration: step.durationSec,
                melody
              }

              log(`triggering alarm - step ${alarm.stepIndex + 1} (restored):`, step)

              try {
                await mqtt.publish(alarmDevice.commandTopic, alarmPayload)
                alarm.triggered = true
              } catch (error) {
                log(`failed to publish alarm - step ${alarm.stepIndex + 1} (restored):`, error.message)
              }
            }, remaining)

            timers.push(timer)
          } else {
            // Timer should have already fired, trigger immediately
            log(`alarm step ${alarm.stepIndex + 1} expired during downtime, triggering immediately`)

            const alarmPayload = {
              alarm: true,
              volume: step.volume,
              duration: step.durationSec,
              melody
            }

            mqtt.publish(alarmDevice.commandTopic, alarmPayload)
              .then(() => {
                alarm.triggered = true
              })
              .catch(error => {
                log(`failed to publish alarm - step ${alarm.stepIndex + 1} (immediate):`, error.message)
              })
          }
        })
      }

      // If the service restarted while the door was recorded as open, do NOT
      // act on that persisted state yet. A transient glitch or a stuck sensor
      // can set doorState=true before a restart, so the persisted "open" may be
      // false. Wait for the first live sensor reading to confirm the door is
      // still open before resuming the escalation. This prevents the siren from
      // sounding on a stale/false "open" after a restart.
      let awaitingRestartConfirmation =
        persistedCache.doorState === true && persistedCache.doorOpenTime != null

      if (awaitingRestartConfirmation) {
        const elapsed = Date.now() - persistedCache.doorOpenTime
        log(`door recorded open before restart (${elapsed/60000} min); waiting for a live reading to confirm before resuming alarms`)
      }

      await mqtt.subscribe(doorSensor.statusTopic, async (payload) => {
        // Payload validation
        if (!payload) {
          log('received null/undefined payload, ignoring')
          return
        }

        if (typeof payload.state !== 'boolean') {
          log('received invalid payload (state not boolean):', payload)
          return
        }

        const newDoorState = payload.state

        // First valid reading after a restart that happened while the door was
        // open: confirm the live state before resuming any escalation. This is
        // the guard that stops a stale/false persisted "open" from triggering
        // the siren on startup.
        if (awaitingRestartConfirmation) {
          awaitingRestartConfirmation = false
          if (newDoorState) {
            log('restart confirmation: door still open, resuming escalation')
            doorState = true
            persistedCache.doorState = true
            restorePendingAlarms()
          } else {
            log('restart confirmation: door is closed, discarding stale open state')
            doorState = false
            persistedCache.doorState = false
            persistedCache.doorOpenTime = null
            persistedCache.pendingAlarms = []
          }
          return
        }

        // Handle duplicate messages - only process state changes
        if (newDoorState === doorState) {
          log(`received duplicate door ${newDoorState ? 'open' : 'closed'} message, ignoring`)
          return
        }

        if (newDoorState && !doorState) {
          // Door opened
          log('door opened, scheduling alarms')
          doorState = true
          persistedCache.doorState = true
          scheduleAlarms()
        } else if (!newDoorState && doorState) {
          // Door closed
          log('door closed, cancelling alarms and stopping alarm')
          doorState = false
          persistedCache.doorState = false
          await cancelAlarms()
        }
      })
    }
  }
}
