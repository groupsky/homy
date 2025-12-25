const StateFeature = require('./state')

module.exports = (feature, opts) => (services) => {
  // Use state feature as base but with specific handling for manual overrides
  const stateFeature = StateFeature(feature, {
    ...opts,
    retain: true // Manual overrides should be retained
  })(services)

  // Override the state setter to handle special manual override commands
  const originalSetState = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(stateFeature), 'state').set

  Object.defineProperty(stateFeature, 'state', {
    get() {
      return this._state
    },
    set(newVal) {
      // Handle special manual override commands
      if (newVal === 'clear' || newVal === null) {
        // Clear override command
        originalSetState.call(this, { state: 'clear', _src: 'ha' })
      } else if (typeof newVal === 'boolean') {
        // Boolean override command
        originalSetState.call(this, { state: newVal, _src: 'ha' })
      } else if (typeof newVal === 'object' && newVal.state !== undefined) {
        // Object with state and optional duration
        originalSetState.call(this, { ...newVal, _src: 'ha' })
      } else {
        // Pass through other values
        originalSetState.call(this, newVal)
      }
    }
  })

  return stateFeature
}