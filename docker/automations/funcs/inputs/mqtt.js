module.exports =
  // create
  ({ topic }) =>
    // start
    ({ mqtt }) =>
      // run
      (cb) =>
        mqtt.subscribe(topic, cb)
