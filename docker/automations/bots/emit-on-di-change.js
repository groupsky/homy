module.exports = (name, { diTopic, mask, outputTopic, outputMessage }) => ({
  start: ({ mqtt }) => {
    let state = null

    mqtt.subscribe(diTopic, (payload) => {
      const newState = payload.inputs & mask
      if (state == null) {
        state = newState
      } else if (newState !== state) {
        state = newState
        mqtt.publish(outputTopic, outputMessage)
      }
    })
  }
})
