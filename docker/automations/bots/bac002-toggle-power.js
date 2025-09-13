module.exports = (name, { bacTopic: topicPrefix, switches }) => ({
  start: async ({ mqtt, createPersistedState }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`

    const defaultState = {
      switchStates: new Array(switches.length).fill(false),
      wasOn: false
    }

    const persistedState = await createPersistedState(defaultState)

    switches.forEach(({topic, isOpen}, index) => {
      mqtt.subscribe(topic, (payload) => {
        persistedState.switchStates[index] = isOpen(payload)
      })
    })

    mqtt.subscribe(readingTopic, (payload) => {
      const allClosed = persistedState.switchStates.every(open => !open)

      if (payload.power === 'on' && !allClosed) {
        mqtt.publish(writeTopic, { power: 'off' })
        persistedState.wasOn = true
      } else if (persistedState.wasOn && payload.power === 'off' && allClosed) {
        mqtt.publish(writeTopic, { power: 'on' })
        persistedState.wasOn = false
      }
    })
  }
})
