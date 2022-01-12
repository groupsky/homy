const weekDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

module.exports = (name, { topic: topicPrefix }) => ({
  start: ({ mqtt }) => {
    const readingTopic = `${topicPrefix}/reading`
    const writeTopic = `${topicPrefix}/write`

    mqtt.subscribe(readingTopic, (payload) => {
      const now = new Date(payload._tz)
      // skip on top of hour as due to internal seconds it cannot be brought in sync
      if (now.getMinutes() === 1 || now.getMinutes() === 59) {
        return
      }

      // a minute difference happens due to unsynced seconds
      if (payload.minutes != null && Math.abs(payload.minutes - now.getMinutes()) > 1) {
          mqtt.publish(writeTopic, { minutes: new Date().getMinutes() })
      }
      if (payload.hours != null && payload.hours !== now.getHours()) {
          mqtt.publish(writeTopic, { hours: new Date().getHours() })
      }
      if (payload.weekDay != null && payload.weekDay !== weekDays[now.getDay()]) {
          mqtt.publish(writeTopic, { weekDay: weekDays[new Date().getDay()] })
      }
    })
  }
})
