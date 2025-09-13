module.exports = (name, { bacTopic: topicPrefix, switches }) => ({
  start: async ({ mqtt, state }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`

    const defaultState = {
      switchStates: new Array(switches.length).fill(false),
      wasOn: false
    }

    const currentState = await state.get(defaultState)

    switches.forEach(({topic, isOpen}, index) => {
      mqtt.subscribe(topic, (payload) => {
        const newState = { ...currentState }
        newState.switchStates[index] = isOpen(payload)

        Object.assign(currentState, newState)
        state.set(newState)
      })
    })

    mqtt.subscribe(readingTopic, (payload) => {
      const allClosed = currentState.switchStates.every(open => !open)
      const newState = { ...currentState }

      if (payload.power === 'on' && !allClosed) {
        mqtt.publish(writeTopic, { power: 'off' })
        newState.wasOn = true
      } else if (currentState.wasOn && payload.power === 'off' && allClosed) {
        mqtt.publish(writeTopic, { power: 'on' })
        newState.wasOn = false
      }

      if (newState.wasOn !== currentState.wasOn) {
        Object.assign(currentState, newState)
        state.set(newState)
      }
    })
  }
})
