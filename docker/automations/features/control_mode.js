const StateFeature = require('./state')

module.exports = (feature, opts) => (services) => {
  // Use state feature as base but with specific handling for control modes
  const stateFeature = StateFeature(feature, {
    ...opts,
    retain: true // Control mode should be retained
  })(services)

  // Override the state setter to handle control mode commands
  const originalSetState = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(stateFeature), 'state').set

  Object.defineProperty(stateFeature, 'state', {
    get() {
      return this._state
    },
    set(newVal) {
      // Handle Home Assistant select commands
      const validModes = ['automatic', 'manual_on', 'manual_off', 'vacation_3d', 'vacation_5d', 'vacation_7d', 'vacation_10d', 'vacation_14d']

      if (typeof newVal === 'string') {
        // Direct mode selection from HA
        const mode = newVal
        if (validModes.includes(mode)) {
          originalSetState.call(this, { mode, _src: 'ha' })
        } else {
          // Invalid mode, ignore
          console.warn(`Invalid control mode: ${mode}`)
        }
      } else if (typeof newVal === 'object' && newVal.mode !== undefined) {
        // Object with mode and optional metadata
        if (validModes.includes(newVal.mode)) {
          originalSetState.call(this, { ...newVal, _src: newVal._src || 'ha' })
        } else {
          console.warn(`Invalid control mode in object: ${newVal.mode}`)
        }
      } else {
        // Pass through other values for backward compatibility
        originalSetState.call(this, newVal)
      }
    }
  })

  return stateFeature
}