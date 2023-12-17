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
      if (listenFilter(payload)) {
        if (!timer) {
          timer = setTimeout(() => {
            mqtt.publish(emitTopic, emitValue instanceof Function ? emitValue(payload) : emitValue)
          }, timeout)
        }
      } else {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }
    })
  }
})
