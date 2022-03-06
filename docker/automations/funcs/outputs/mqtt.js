module.exports =
  // create
  ({
    topic,
    content = 'json',
    qos = 0,
    retain = false
  }) =>
    // start
    ({ mqtt }) =>
      // run
      (payload) =>
        mqtt.publish(topic, payload, { content, qos, retain })
