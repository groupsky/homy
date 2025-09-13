module.exports = function createStatefulCounter(name, config) {
  return {
    start: async ({ mqtt, state }) => {
      const defaultState = {
        count: 0,
        lastReset: new Date().toISOString(),
        totalIncrements: 0
      }

      const currentState = await state.get(defaultState)

      await mqtt.subscribe(config.incrementTopic, (message) => {
        const newState = {
          ...currentState,
          count: currentState.count + (message.increment || 1),
          totalIncrements: currentState.totalIncrements + 1
        }

        Object.assign(currentState, newState)
        state.set(newState)

        if (config.outputTopic) {
          mqtt.publish(config.outputTopic, {
            count: newState.count,
            totalIncrements: newState.totalIncrements,
            botName: name
          })
        }
      })

      if (config.resetTopic) {
        await mqtt.subscribe(config.resetTopic, () => {
          const newState = {
            count: 0,
            lastReset: new Date().toISOString(),
            totalIncrements: currentState.totalIncrements
          }

          Object.assign(currentState, newState)
          state.set(newState)

          if (config.outputTopic) {
            mqtt.publish(config.outputTopic, {
              count: 0,
              lastReset: newState.lastReset,
              totalIncrements: newState.totalIncrements,
              botName: name,
              action: 'reset'
            })
          }
        })
      }

      if (config.statusTopic) {
        await mqtt.subscribe(config.statusTopic, () => {
          mqtt.publish(config.outputTopic || `${config.statusTopic}/response`, {
            ...currentState,
            botName: name,
            action: 'status'
          })
        })
      }
    }
  }
}
