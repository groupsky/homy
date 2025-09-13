module.exports = (name, { bacTopic: topicPrefix, switches }) => ({
  persistedCache: {
    version: 1,
    default: {
      switchStates: new Array(switches.length).fill(false),
      wasOn: false
    }
  },

  start: async ({ mqtt, persistedCache }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`

    switches.forEach(({topic, isOpen}, index) => {
      mqtt.subscribe(topic, (payload) => {
        persistedCache.switchStates[index] = isOpen(payload)
      })
    })

    mqtt.subscribe(readingTopic, (payload) => {
      const allClosed = persistedCache.switchStates.every(open => !open)

      if (payload.power === 'on' && !allClosed) {
        mqtt.publish(writeTopic, { power: 'off' })
        persistedCache.wasOn = true
      } else if (persistedCache.wasOn && payload.power === 'off' && allClosed) {
        mqtt.publish(writeTopic, { power: 'on' })
        persistedCache.wasOn = false
      }
    })
  }
})
