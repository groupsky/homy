const resolve = require('../lib/resolve')

module.exports = (name, { diTopic, di, value, outputTopic, outputMessage }) => {
  return ({
    start: ({ mqtt }) => {
      mqtt.subscribe(diTopic, (payload) => {
        if (Boolean(payload.inputs & (1 << di)) === value) {
          mqtt.publish(outputTopic, outputMessage)
        }
      })
    }
  })
}

