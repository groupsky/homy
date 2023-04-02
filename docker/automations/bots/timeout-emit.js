module.exports = (name, {
  listenTopic,
  listenFilter = () => true,
  timeout,
  emitTopic,
  emitValue
}) => ({
  start: ({ mqtt }) => {
    let timer = null

    mqtt.subscribe(listenTopic, (payload) => {
      clearTimeout(timer)
      if (listenFilter(payload)) {
        timer = setTimeout(() => {
          mqtt.publish(emitTopic, emitValue instanceof Function ? emitValue(payload) : emitValue)
        }, timeout)
      }
    })
  }
})
