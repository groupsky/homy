class HaBinarySensor {
  constructor (topic, config) {
    this.topic = topic
    this.config = config
    this._state = null
  }

  get configTopic () { return this.topic + '/config' }

  get stateTopic () { return this.topic + '/status' }

  get state () { return this._state }

  set state (value) {
    this._state = value
    this.publishState()
  }

  start ({ mqtt }) {
    this.mqtt = mqtt

    mqtt.publish(this.configTopic, {
      ...this.config,
      state_topic: this.stateTopic,
      value_template: "{{ value_json.state }}"
    }, { retain: true })

    if (this.state !== null) {
      this.publishState()
    }
  }

  publishState () {
    if (this.mqtt) {
      this.mqtt.publish(this.stateTopic, {
        state: this.state === true ? 'ON' : this.state === false ? 'OFF' : null
      }, {
        retain: true
      })
    }
  }
}

module.exports = HaBinarySensor
