const HaBinarySensor = require('../lib/ha/binary_sensor')

module.exports = (name, {
  stateTopic,
  stateParser,
  ha: { enabled: haEnabled = false, topic: haTopic, config: haConfig } = {}
}) => ({
  start: ({ mqtt }) => {
    let state = null

    const ha = new HaBinarySensor(haTopic, haConfig)

    const setState = (newState) => {
      if (newState === state) {
        return
      }
      // emit new state
      ha.state = state = newState
    }

    const heartbeat = (counter) => {
      // TODO: handle heartbeat
    }

    mqtt.subscribe(stateTopic, (payload) => {
        heartbeat()

        const newState = stateParser(payload)
        setState(newState)
      }
    )

    if (haEnabled) {
      ha.start({ mqtt })
    }
  }
})
