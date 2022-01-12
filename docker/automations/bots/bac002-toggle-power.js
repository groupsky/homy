const { write } = require('../../modbus-serial/devices/bac002')
module.exports = (name, { bacTopic: topicPrefix, switches }) => ({
  start: ({ mqtt }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`

    const state = []
    let wasOn = false

    switches.forEach(({topic, isOpen}, index) => {
      mqtt.subscribe(topic, (payload) => state[index] = isOpen(payload))
    })

    mqtt.subscribe(readingTopic, (payload) => {
      const allClosed = state.every(open => !open)
      if (payload.power === 'on' && !allClosed) {
        mqtt.publish(writeTopic, { power: 'off' })
        wasOn = true
      } else if (wasOn && payload.power === 'off' && allClosed) {
        mqtt.publish(writeTopic, { power: 'on' })
        wasOn = false
      }
    })
  }
})
