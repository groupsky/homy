module.exports = (name, {
  temperatureTopTopic,
  temperatureBottomTopic,
  solarTemperatureTopic,
  ambientTemperatureTopic,
  solarCirculationTopic,
  boilerRelayTopic,
  controlModeTopic,
  controlModeStatusTopic,
  automationStatusTopic,
  manualOverrideExpiry = 24 * 60 * 60 * 1000, // 24 hours default
  // Temperature thresholds
  comfortMin = 50,
  emergencyMin = 45,
  maxSafe = 70,
  solarAdvantageMin = 5,
  solarDisadvantageMax = -3,
  hysteresis = 3,
  verbose
}) => ({
  persistedCache: {
    version: 1,
    default: {
      controlMode: 'automatic',
      manualOverrideExpires: null
    },
    migrate: ({ version, defaultState, state }) => {
      return state
    }
  },

  start: ({ mqtt, persistedCache }) => {
    let currentState = {
      temperatureTop: null,
      temperatureBottom: null,
      solarTemperature: null,
      ambientTemperature: null,
      solarCirculation: false,
      heaterState: false,
      controlMode: 'automatic',
      manualOverrideExpires: null,
      lastDecision: null,
      lastDecisionReason: null
    }

    // Load persistent state from cache
    const loadState = () => {
      // Restore control mode
      currentState.controlMode = persistedCache.controlMode || 'automatic'

      // Only restore manual override expiry if not expired
      if (persistedCache.manualOverrideExpires && Date.now() < persistedCache.manualOverrideExpires) {
        currentState.manualOverrideExpires = persistedCache.manualOverrideExpires
        if (verbose) {
          console.log(`[${name}] restored control mode: ${currentState.controlMode} expires at ${new Date(persistedCache.manualOverrideExpires)}`)
        }
      } else if (currentState.controlMode !== 'automatic') {
        // Manual mode expired, reset to automatic
        currentState.controlMode = 'automatic'
        persistedCache.controlMode = 'automatic'
        if (verbose) {
          console.log(`[${name}] manual override expired, reset to automatic mode`)
        }
      }
    }

    const saveState = () => {
      persistedCache.controlMode = currentState.controlMode
      persistedCache.manualOverrideExpires = currentState.manualOverrideExpires
    }

    // Use configured topics (with fallbacks for backward compatibility)
    const finalControlModeStatusTopic = controlModeStatusTopic || controlModeTopic.replace('/set', '/status')
    const finalAutomationStatusTopic = automationStatusTopic || `homy/automation/${name}/status`

    const publishControlModeStatus = () => {
      mqtt.publish(finalControlModeStatusTopic, {
        mode: currentState.controlMode,
        manualOverrideExpires: currentState.manualOverrideExpires,
        timestamp: new Date().toISOString()
      })
    }

    const makeDecision = () => {
      const now = Date.now()

      // Check if manual mode is active and not expired
      if (currentState.controlMode !== 'automatic') {
        if (currentState.manualOverrideExpires && now >= currentState.manualOverrideExpires) {
          // Manual mode expired
          currentState.controlMode = 'automatic'
          currentState.manualOverrideExpires = null
          saveState()
          publishControlModeStatus()
          if (verbose) {
            console.log(`[${name}] manual mode expired, resuming automatic control`)
          }
        } else {
          // Manual or vacation mode active
          let decision
          let reasonPrefix

          if (currentState.controlMode === 'manual_on') {
            decision = true
            reasonPrefix = 'manual_on'
          } else if (currentState.controlMode === 'manual_off' || currentState.controlMode.startsWith('vacation_')) {
            decision = false
            reasonPrefix = currentState.controlMode
          } else {
            // Fallback for unknown modes
            decision = false
            reasonPrefix = 'unknown_mode'
          }

          if (verbose) {
            console.log(`[${name}] ${currentState.controlMode} mode active -> heater ${decision ? 'ON' : 'OFF'}`)
          }
          return {
            decision,
            reason: `${reasonPrefix} (expires: ${new Date(currentState.manualOverrideExpires)})`
          }
        }
      }

      const { temperatureTop, temperatureBottom, solarTemperature, solarCirculation } = currentState

      // Safety checks first
      if (temperatureTop !== null && temperatureTop >= maxSafe) {
        return { decision: false, reason: `safety_shutoff_temp_${temperatureTop}C` }
      }

      // Emergency heating - temperature too low
      if (temperatureTop !== null && temperatureTop < emergencyMin) {
        return { decision: true, reason: `emergency_heating_top_${temperatureTop}C` }
      }

      if (temperatureBottom !== null && temperatureBottom < emergencyMin) {
        return { decision: true, reason: `emergency_heating_bottom_${temperatureBottom}C` }
      }

      // Comfort heating
      if (temperatureTop !== null && temperatureTop < comfortMin) {
        return { decision: true, reason: `comfort_heating_top_${temperatureTop}C` }
      }

      // Solar heating considerations
      if (temperatureTop !== null && solarTemperature !== null) {
        const solarAdvantage = solarTemperature - temperatureTop

        // Solar heating is very effective
        if (solarAdvantage >= solarAdvantageMin && solarCirculation) {
          return { decision: false, reason: `solar_priority_advantage_${solarAdvantage.toFixed(1)}C` }
        }

        // Solar heating is insufficient
        if (solarAdvantage <= solarDisadvantageMax) {
          return { decision: true, reason: `solar_insufficient_disadvantage_${solarAdvantage.toFixed(1)}C` }
        }
      }

      // Temperature is sufficient, check hysteresis
      if (temperatureTop !== null && temperatureTop >= (comfortMin + hysteresis)) {
        return { decision: false, reason: `sufficient_temp_${temperatureTop}C` }
      }

      // Default to maintaining current state (hysteresis zone)
      return {
        decision: currentState.heaterState,
        reason: `hysteresis_zone_maintain_${currentState.heaterState}`
      }
    }

    const updateHeaterState = () => {
      const { decision, reason } = makeDecision()

      if (decision !== currentState.heaterState || reason !== currentState.lastDecisionReason) {
        currentState.heaterState = decision
        currentState.lastDecision = Date.now()
        currentState.lastDecisionReason = reason

        if (verbose) {
          console.log(`[${name}] heater decision: ${decision} (${reason})`)
          console.log(`[${name}] temperatures: top=${currentState.temperatureTop}°C, bottom=${currentState.temperatureBottom}°C, solar=${currentState.solarTemperature}°C`)
        }

        mqtt.publish(boilerRelayTopic, {
          state: decision,
          _src: 'boiler_controller',
          reason,
          timestamp: new Date().toISOString(),
          temperatures: {
            top: currentState.temperatureTop,
            bottom: currentState.temperatureBottom,
            solar: currentState.solarTemperature,
            ambient: currentState.ambientTemperature
          }
        })

        // Publish status for monitoring
        mqtt.publish(finalAutomationStatusTopic, {
          heaterState: decision,
          reason,
          controlMode: currentState.controlMode,
          manualOverrideExpires: currentState.manualOverrideExpires,
          temperatures: {
            top: currentState.temperatureTop,
            bottom: currentState.temperatureBottom,
            solar: currentState.solarTemperature,
            ambient: currentState.ambientTemperature
          },
          solarCirculation: currentState.solarCirculation,
          timestamp: new Date().toISOString()
        })

        // Publish control mode status
        publishControlModeStatus()
      }
    }

    // Initialize from cache
    loadState()

    // Subscribe to temperature sensors
    mqtt.subscribe(temperatureTopTopic, (payload) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload
        const temp = typeof data === 'object' ? data.state : data
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.temperatureTop = temp
          updateHeaterState()
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing top temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(temperatureBottomTopic, (payload) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload
        const temp = typeof data === 'object' ? data.state : data
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.temperatureBottom = temp
          updateHeaterState()
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing bottom temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(solarTemperatureTopic, (payload) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload
        const temp = typeof data === 'object' ? data.state : data
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.solarTemperature = temp
          updateHeaterState()
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing solar temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(ambientTemperatureTopic, (payload) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload
        const temp = typeof data === 'object' ? data.state : data
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.ambientTemperature = temp
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing ambient temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(solarCirculationTopic, (payload) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload
        const state = typeof data === 'object' ? data.state : data
        currentState.solarCirculation = state === 'on' || state === true
        updateHeaterState()
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing solar circulation:`, err.message)
        }
      }
    })

    // Control mode topic
    mqtt.subscribe(controlModeTopic, (payload) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload

        let newMode = null
        let duration = manualOverrideExpiry

        // Handle different payload formats
        if (typeof data === 'string') {
          // Direct mode string from HA select
          newMode = data
        } else if (typeof data === 'object' && data.mode) {
          // Object with mode and optional duration
          newMode = data.mode
          duration = data.duration || manualOverrideExpiry
        }

        // Calculate vacation duration with smart timing
        // Logic: Vacation typically starts in the morning (8-10am) and people return in the evening (6-8pm)
        // We subtract 6 hours from the nominal vacation days to ensure hot water is ready for evening return
        // Example: 3-day vacation starting Monday 9am -> ends Wednesday 3pm (heater resumes for evening shower)
        const calculateVacationDuration = (mode) => {
          const vacationHours = {
            vacation_3d: 3 * 24 - 6,   // 2.25 days (66 hours) - weekend getaway
            vacation_5d: 5 * 24 - 6,   // 4.75 days (114 hours) - extended weekend
            vacation_7d: 7 * 24 - 6,   // 6.75 days (162 hours) - week vacation
            vacation_10d: 10 * 24 - 6, // 9.75 days (234 hours) - extended vacation
            vacation_14d: 14 * 24 - 6  // 13.75 days (330 hours) - two week vacation
          }
          return vacationHours[mode] ? vacationHours[mode] * 60 * 60 * 1000 : duration
        }

        // Validate and set new mode
        const validModes = ['automatic', 'manual_on', 'manual_off', 'vacation_3d', 'vacation_5d', 'vacation_7d', 'vacation_10d', 'vacation_14d']

        if (validModes.includes(newMode)) {
          currentState.controlMode = newMode

          if (newMode === 'automatic') {
            // Clear manual override expiry for automatic mode
            currentState.manualOverrideExpires = null
          } else if (newMode.startsWith('vacation_')) {
            // Calculate smart vacation timing (6 hours before evening return)
            const vacationDuration = calculateVacationDuration(newMode)
            currentState.manualOverrideExpires = Date.now() + vacationDuration
          } else {
            // Set expiry for manual modes
            currentState.manualOverrideExpires = Date.now() + duration
          }

          saveState()
          publishControlModeStatus()

          if (verbose) {
            const durationMinutes = currentState.manualOverrideExpires ?
              (currentState.manualOverrideExpires - Date.now()) / 60000 : 0
            console.log(`[${name}] control mode set to: ${newMode}${newMode !== 'automatic' ? ` for ${(durationMinutes/60).toFixed(1)} hours` : ''}`)
          }

          updateHeaterState()
        } else {
          if (verbose) {
            console.log(`[${name}] invalid control mode: ${newMode}`)
          }
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing control mode:`, err.message)
        }
      }
    })

    // Initial decision and status
    updateHeaterState()
    publishControlModeStatus()

    if (verbose) {
      console.log(`[${name}] boiler controller started with config:`, {
        comfortMin,
        emergencyMin,
        maxSafe,
        solarAdvantageMin,
        solarDisadvantageMax,
        hysteresis,
        manualOverrideExpiry: manualOverrideExpiry / 60000 + ' minutes'
      })
    }
  }
})