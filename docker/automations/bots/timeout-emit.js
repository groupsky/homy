module.exports = (name, {
  listenTopic,
  listenFilter = () => true,
  timeout,
  emitTopic,
  emitValue,
  verbose
}) => ({
  start: ({ mqtt }) => {
    let timer = null

    mqtt.subscribe(listenTopic, (payload) => {
      if (listenFilter(payload)) {
        if (verbose) {
          console.log(`[${name}] received`, payload, timer ? 'timer already started': `starting timer for ${timeout/60000} minutes`)
        }
        if (!timer) {
          timer = setTimeout(() => {
            mqtt.publish(emitTopic, emitValue instanceof Function ? emitValue(payload) : emitValue)
          }, timeout)
        }
      } else {
        if (verbose) {
          console.log(`[${name}] received`, payload, timer ? 'stopping timer': 'no pending timer')
        }
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      }
    })
  }
})
