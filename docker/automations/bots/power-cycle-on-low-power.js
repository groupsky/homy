/**
 * Power Cycle on Low Power Bot
 *
 * Monitors power consumption on a specific phase and triggers a power cycle
 * when power remains below threshold for a configured duration.
 * Prevents repeated cycling during low power conditions.
 */

module.exports = (name, config) => {
  const {
    powerMonitor,
    controlDevice,
    powerCycle,
    verbose = false
  } = config

  // Configuration validation
  if (!powerMonitor?.statusTopic) {
    throw new Error(`[${name}] powerMonitor.statusTopic is required`)
  }
  if (!powerMonitor?.powerField) {
    throw new Error(`[${name}] powerMonitor.powerField is required`)
  }
  if (typeof powerMonitor?.threshold !== 'number' || powerMonitor.threshold < 0) {
    throw new Error(`[${name}] powerMonitor.threshold must be a positive number`)
  }
  if (typeof powerMonitor?.durationMs !== 'number' || powerMonitor.durationMs <= 0) {
    throw new Error(`[${name}] powerMonitor.durationMs must be a positive number`)
  }
  if (!controlDevice?.commandTopic) {
    throw new Error(`[${name}] controlDevice.commandTopic is required`)
  }
  if (typeof powerCycle?.offDurationMs !== 'number' || powerCycle.offDurationMs <= 0) {
    throw new Error(`[${name}] powerCycle.offDurationMs must be a positive number`)
  }
  if (powerCycle.offDurationMs < 5000) {
    throw new Error(`[${name}] powerCycle.offDurationMs must be at least 5000ms`)
  }

  const log = (...args) => {
    if (verbose) {
      console.log(`[${name}]`, ...args)
    }
  }

  return {
    persistedCache: {
      version: 2,
      default: {
        lowPowerStartTime: null,  // Timestamp when power dropped below threshold
        cyclingInProgress: false,  // Flag to prevent repeated cycling
        lastPowerValue: null,  // Last recorded power value
        cycleOffTime: null  // Timestamp when OFF command was sent
      },
      migrate: ({ version, defaultState, state }) => {
        // Add cycleOffTime if upgrading from v1
        if (!state.cycleOffTime) {
          state.cycleOffTime = null
        }
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      let lowPowerTimer = null

      const clearLowPowerTimer = () => {
        if (lowPowerTimer) {
          clearTimeout(lowPowerTimer)
          lowPowerTimer = null
        }
      }

      const sendOnCommandWithRetry = async (maxRetries = 5) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            await mqtt.publish(controlDevice.commandTopic, { state: 'ON' })
            log('power cycle completed')
            return true
          } catch (error) {
            if (attempt === maxRetries) {
              log(`failed to send ON command after ${maxRetries} retries:`, error.message)
              return false
            }
            const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
            log(`failed to send ON command (attempt ${attempt}/${maxRetries}), retrying in ${backoffMs}ms`)
            await new Promise(resolve => setTimeout(resolve, backoffMs))
          }
        }
        return false
      }

      const executePowerCycle = async () => {
        if (persistedCache.cyclingInProgress) {
          log('cycling already in progress, skipping')
          return
        }

        log('starting power cycle')
        // Make cyclingInProgress flag atomic - set immediately
        persistedCache.cyclingInProgress = true
        clearLowPowerTimer()
        persistedCache.lowPowerStartTime = null

        // Send OFF command
        try {
          log('sending OFF command')
          await mqtt.publish(controlDevice.commandTopic, { state: 'OFF' })
          // Store OFF time for restoration after restart
          persistedCache.cycleOffTime = Date.now()
        } catch (error) {
          log('failed to send OFF command:', error.message)
          persistedCache.cyclingInProgress = false
          persistedCache.cycleOffTime = null
          return
        }

        // Wait for off duration, then send ON command with retry
        setTimeout(async () => {
          log('sending ON command')
          const success = await sendOnCommandWithRetry()
          if (!success) {
            log('WARNING: Failed to send ON after all retries - device may be stuck OFF')
          }
          persistedCache.cyclingInProgress = false
          persistedCache.cycleOffTime = null
        }, powerCycle.offDurationMs)
      }

      const schedulePowerCycle = (delay) => {
        clearLowPowerTimer()

        if (delay <= 0) {
          // Trigger immediately if delay already elapsed
          log('low power duration already elapsed, triggering power cycle immediately')
          executePowerCycle()
        } else {
          log(`scheduling power cycle in ${delay / 60000} minutes`)
          lowPowerTimer = setTimeout(() => {
            executePowerCycle()
          }, delay)
        }
      }

      // Restore ON timer if power cycle was in progress during restart
      if (persistedCache.cyclingInProgress && persistedCache.cycleOffTime) {
        const elapsed = Date.now() - persistedCache.cycleOffTime
        const remaining = powerCycle.offDurationMs - elapsed

        log(`restoring ON timer, ${elapsed / 1000}s elapsed, ${Math.max(0, remaining) / 1000}s remaining`)

        if (remaining > 0) {
          // Schedule ON command for remaining time
          setTimeout(async () => {
            log('sending ON command (restored timer)')
            const success = await sendOnCommandWithRetry()
            if (!success) {
              log('WARNING: Failed to send ON after all retries - device may be stuck OFF')
            }
            persistedCache.cyclingInProgress = false
            persistedCache.cycleOffTime = null
          }, remaining)
        } else {
          // Timer already elapsed - send ON immediately (in next tick to avoid blocking start())
          log('ON timer already elapsed, sending ON immediately')
          setTimeout(async () => {
            const success = await sendOnCommandWithRetry()
            if (!success) {
              log('WARNING: Failed to send ON after all retries - device may be stuck OFF')
            }
            persistedCache.cyclingInProgress = false
            persistedCache.cycleOffTime = null
          }, 0)
        }
      }
      // Restore low power timer if condition persisted across restart (but not during cycling)
      else if (persistedCache.lowPowerStartTime && !persistedCache.cyclingInProgress) {
        const elapsed = Date.now() - persistedCache.lowPowerStartTime
        const remaining = powerMonitor.durationMs - elapsed

        log(`restoring low power timer, ${elapsed / 60000} minutes elapsed, ${remaining / 60000} minutes remaining`)

        schedulePowerCycle(remaining)
      }

      await mqtt.subscribe(powerMonitor.statusTopic, async (payload) => {
        // Payload validation
        if (!payload) {
          log('received null/undefined payload, ignoring')
          return
        }

        const powerValue = payload[powerMonitor.powerField]

        if (typeof powerValue !== 'number') {
          log('received invalid payload (power field not a number):', payload)
          return
        }

        // Update last power value
        persistedCache.lastPowerValue = powerValue

        // Check if we're currently cycling - ignore messages during cycle
        if (persistedCache.cyclingInProgress) {
          log(`power update ignored during cycling: ${powerValue}W`)
          return
        }

        const isBelowThreshold = powerValue < powerMonitor.threshold

        if (isBelowThreshold) {
          // Power is below threshold (including 0W = device turned off)
          if (!persistedCache.lowPowerStartTime) {
            // Low power condition just started
            log(`power below threshold (${powerValue}W < ${powerMonitor.threshold}W), starting timer`)
            persistedCache.lowPowerStartTime = Date.now()
            schedulePowerCycle(powerMonitor.durationMs)
          } else {
            // Low power condition continuing
            log(`power still below threshold: ${powerValue}W`)
          }
        } else {
          // Power is above threshold
          if (persistedCache.lowPowerStartTime) {
            // Low power condition ended
            log(`power returned to normal (${powerValue}W >= ${powerMonitor.threshold}W), cancelling timer`)
            clearLowPowerTimer()
            persistedCache.lowPowerStartTime = null
          } else {
            // Normal operation
            log(`power normal: ${powerValue}W`)
          }
        }
      })
    }
  }
}
