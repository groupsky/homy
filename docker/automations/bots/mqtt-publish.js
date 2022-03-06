module.exports = (name, {
  topic,
  payload,
  content = 'json',
  qos = 0,
  retain = false
}) => ({
  start: ({ mqtt }) => {
    mqtt.publish(topic, payload, { content, qos, retain })
  }
})
