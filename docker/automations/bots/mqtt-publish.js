module.exports = (name, {
  topic,
  payload,
}) => ({
  start: ({ mqtt }) => {
    mqtt.publish(topic, payload)
  }
})
