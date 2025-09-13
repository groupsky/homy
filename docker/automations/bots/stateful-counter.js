module.exports = function createStatefulCounter(name, config) {
  return {
    start: async ({ mqtt, createPersistedState }) => {
      const defaultState = {
        count: 0,
        lastReset: new Date().toISOString(),
        totalIncrements: 0
      }

      const persistedState = await createPersistedState(defaultState)

      await mqtt.subscribe(config.incrementTopic, (message) => {
        persistedState.count += (message.increment || 1)
        persistedState.totalIncrements += 1

        if (config.outputTopic) {
          mqtt.publish(config.outputTopic, {
            count: persistedState.count,
            totalIncrements: persistedState.totalIncrements,
            botName: name
          })
        }
      })

      if (config.resetTopic) {
        await mqtt.subscribe(config.resetTopic, () => {
          persistedState.count = 0
          persistedState.lastReset = new Date().toISOString()

          if (config.outputTopic) {
            mqtt.publish(config.outputTopic, {
              count: 0,
              lastReset: persistedState.lastReset,
              totalIncrements: persistedState.totalIncrements,
              botName: name,
              action: 'reset'
            })
          }
        })
      }

      if (config.statusTopic) {
        await mqtt.subscribe(config.statusTopic, () => {
          mqtt.publish(config.outputTopic || `${config.statusTopic}/response`, {
            count: persistedState.count,
            lastReset: persistedState.lastReset,
            totalIncrements: persistedState.totalIncrements,
            botName: name,
            action: 'status'
          })
        })
      }
    }
  }
}
