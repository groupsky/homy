const EventEmitter = require('events')

class HaLight extends EventEmitter {
  constructor (topic, config) {
    super()
    this.topic = topic
    this.config = config
    this._state = null
  }

  get configTopic () { return this.topic + '/config' }

  get commandTopic () { return this.topic + '/set' }

  get stateTopic () { return this.topic + '/status' }

  get state () { return this._state }

  set state (value) {
    this._state = value
    this.publishState()
  }

  start ({ mqtt }) {
    this.mqtt = mqtt

    mqtt.subscribe(this.commandTopic, this.onCommand.bind(this))

    mqtt.publish(this.configTopic, {
      ...this.config,
      schema: 'json',
      retain: true,
      command_topic: this.commandTopic,
      state_topic: this.stateTopic,
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

  onCommand (payload) {
    switch (payload.state) {
      case 'ON':
        this.emit('change', true)
        break
      case 'OFF':
        this.emit('change', false)
        break
      default:
        console.warn('Received command without valid state', payload)
        break
    }
  }
}

module.exports = HaLight
