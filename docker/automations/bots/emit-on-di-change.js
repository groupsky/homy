module.exports = (name, { diTopic, mask, outputTopic, outputMessage, filterState = () => true }) => ({
  start: ({ mqtt }) => {
    let state = null

    mqtt.subscribe(diTopic, (payload) => {
      const newState = payload.inputs & mask
      if (state == null) {
        state = newState
      } else if (newState !== state) {
        const oldState = state
        state = newState
        if (filterState(newState, oldState)) {
          mqtt.publish(outputTopic, outputMessage)
        }
      }
    })
  }
})
