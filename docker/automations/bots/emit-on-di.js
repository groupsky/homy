module.exports = (name, { diTopic, di, value, outputTopic, outputMessage }) => ({
  start: ({ mqtt }) => {
    mqtt.subscribe(diTopic, (payload) => {
      if (Boolean(payload.inputs & (1 << di)) === value) {
        mqtt.publish(outputTopic, outputMessage)
      }
    })
  }
})
