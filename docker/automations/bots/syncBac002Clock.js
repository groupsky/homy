const weekDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

module.exports = (name, { topic: topicPrefix }) => {
  console.log(`init ${name}`)
  return ({
    /**
     * @param {import('mqtt').Client} mqtt
     */
    start: ({ gates: { mqtt } }) => {
      console.log(`starting ${name}`)

      const readingTopic = `${topicPrefix}/reading`
      const writeTopic = `${topicPrefix}/write`

      const pub = (payload) => mqtt.publish(writeTopic, JSON.stringify({
        _bot: name,
        ...payload
      }), (err) => {
        if (err) {
          console.error(`failure sending to ${writeTopic}`, payload)
          return
        }
      })

      mqtt.on('connect', () => {
        mqtt.subscribe(readingTopic, (err) => {
          if (err) {
            console.error(`failure subscribing to ${readingTopic}`, err)
            return
          }
        })
      })
      mqtt.on('message', (topic, rawPayload) => {
        if (topic !== readingTopic) {
          return
        }

        const payload = JSON.parse(rawPayload.toString())
        const now = new Date(payload._tz)
        if (payload.minutes != null && Math.abs(payload.minutes - now.getMinutes()) > 1) {
          pub({ minutes: new Date().getMinutes() })
        }
        if (payload.hours != null && payload.hours !== now.getHours()) {
          pub({ hours: new Date().getHours() })
        }
        if (payload.weekDay != null && payload.weekDay !== weekDays[now.getDay()]) {
          pub({ weekDay: weekDays[new Date().getDay()] })
        }
      })
    }
  })
}
