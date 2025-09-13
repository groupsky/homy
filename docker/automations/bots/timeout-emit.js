module.exports = (name, {
  listenTopic,
  listenFilter = () => true,
  timeout,
  emitTopic,
  emitValue,
  verbose
}) => ({
  persistedCache: {
    version: 1,
    default: {
      timerStartTime: null,
      lastPayload: null,
      timerActive: false
    },
    migrate: ({ version, defaultState, state }) => {
      return state
    }
  },

  start: ({ mqtt, persistedCache }) => {
    let timer = null

    // Restore timer if it was active
    if (persistedCache.timerActive && persistedCache.timerStartTime) {
      const elapsed = Date.now() - persistedCache.timerStartTime
      const remaining = timeout - elapsed

      if (remaining > 0) {
        if (verbose) {
          console.log(`[${name}] restoring timer with ${remaining/60000} minutes remaining`)
        }
        timer = setTimeout(() => {
          const valueToEmit = emitValue instanceof Function ? emitValue(persistedCache.lastPayload) : emitValue
          mqtt.publish(emitTopic, valueToEmit)
          persistedCache.timerActive = false
          persistedCache.timerStartTime = null
          persistedCache.lastPayload = null
          timer = null
        }, remaining)
      } else {
        // Timer should have already fired, emit immediately
        if (verbose) {
          console.log(`[${name}] timer expired during downtime, emitting immediately`)
        }
        const valueToEmit = emitValue instanceof Function ? emitValue(persistedCache.lastPayload) : emitValue
        mqtt.publish(emitTopic, valueToEmit)
        persistedCache.timerActive = false
        persistedCache.timerStartTime = null
        persistedCache.lastPayload = null
      }
    }

    mqtt.subscribe(listenTopic, (payload) => {
      if (listenFilter(payload)) {
        if (verbose) {
          console.log(`[${name}] received`, payload, timer ? 'timer already started': `starting timer for ${timeout/60000} minutes`)
        }
        if (!timer) {
          persistedCache.timerStartTime = Date.now()
          persistedCache.lastPayload = payload
          persistedCache.timerActive = true

          timer = setTimeout(() => {
            const valueToEmit = emitValue instanceof Function ? emitValue(payload) : emitValue
            mqtt.publish(emitTopic, valueToEmit)
            persistedCache.timerActive = false
            persistedCache.timerStartTime = null
            persistedCache.lastPayload = null
            timer = null
          }, timeout)
        }
      } else {
        if (verbose) {
          console.log(`[${name}] received`, payload, timer ? 'stopping timer': 'no pending timer')
        }
        if (timer) {
          clearTimeout(timer)
          timer = null
          persistedCache.timerActive = false
          persistedCache.timerStartTime = null
          persistedCache.lastPayload = null
        }
      }
    })
  }
})
