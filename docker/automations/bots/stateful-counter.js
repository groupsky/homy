module.exports = function createStatefulCounter(name, config) {
  return {
    persistedCache: {
      version: 2,
      default: {
        count: 0,
        lastReset: new Date().toISOString(),
        totalIncrements: 0,
        history: []
      },
      migrate: ({ version, defaultState, state }) => {
        if (!state.history) state.history = []
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {

      await mqtt.subscribe(config.incrementTopic, (message) => {
        const increment = message.increment || 1
        persistedCache.count += increment
        persistedCache.totalIncrements += 1

        // Add to history (new feature in v2)
        persistedCache.history.push({
          timestamp: new Date().toISOString(),
          increment,
          newCount: persistedCache.count
        })

        // Keep only last 10 entries
        if (persistedCache.history.length > 10) {
          persistedCache.history = persistedCache.history.slice(-10)
        }

        if (config.outputTopic) {
          mqtt.publish(config.outputTopic, {
            count: persistedCache.count,
            totalIncrements: persistedCache.totalIncrements,
            history: persistedCache.history,
            botName: name
          })
        }
      })

      if (config.resetTopic) {
        await mqtt.subscribe(config.resetTopic, () => {
          persistedCache.count = 0
          persistedCache.lastReset = new Date().toISOString()

          if (config.outputTopic) {
            mqtt.publish(config.outputTopic, {
              count: 0,
              lastReset: persistedCache.lastReset,
              totalIncrements: persistedCache.totalIncrements,
              botName: name,
              action: 'reset'
            })
          }
        })
      }

      if (config.statusTopic) {
        await mqtt.subscribe(config.statusTopic, () => {
          mqtt.publish(config.outputTopic || `${config.statusTopic}/response`, {
            count: persistedCache.count,
            lastReset: persistedCache.lastReset,
            totalIncrements: persistedCache.totalIncrements,
            botName: name,
            action: 'status'
          })
        })
      }
    }
  }
}
