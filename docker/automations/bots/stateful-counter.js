module.exports = function createStatefulCounter(name, config) {
  return {
    start: async ({ mqtt, state }) => {
      const defaultState = {
        count: 0,
        lastReset: new Date().toISOString(),
        totalIncrements: 0
      }

      const currentState = await state.get(defaultState)

      await mqtt.subscribe(config.incrementTopic, async (message) => {
        const newState = {
          ...currentState,
          count: currentState.count + (message.increment || 1),
          totalIncrements: currentState.totalIncrements + 1
        }

        await state.set(newState)
        Object.assign(currentState, newState)

        if (config.outputTopic) {
          await mqtt.publish(config.outputTopic, {
            count: newState.count,
            totalIncrements: newState.totalIncrements,
            botName: name
          })
        }
      })

      if (config.resetTopic) {
        await mqtt.subscribe(config.resetTopic, async () => {
          const newState = {
            count: 0,
            lastReset: new Date().toISOString(),
            totalIncrements: currentState.totalIncrements
          }

          await state.set(newState)
          Object.assign(currentState, newState)

          if (config.outputTopic) {
            await mqtt.publish(config.outputTopic, {
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
        await mqtt.subscribe(config.statusTopic, async () => {
          const currentStateSnapshot = await state.get(defaultState)

          await mqtt.publish(config.outputTopic || `${config.statusTopic}/response`, {
            ...currentStateSnapshot,
            botName: name,
            action: 'status'
          })
        })
      }
    }
  }
}
