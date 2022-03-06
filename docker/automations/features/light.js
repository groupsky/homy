const EventEmitter = require('events')

class LightFeature extends EventEmitter {
  constructor (featureId, {mqtt}) {
    super()
    this.id = featureId
    this.mqtt = mqtt

    mqtt.subscribe(`homy/features/light/${featureId}/status`, this.onStatusUpdate.bind(this))
  }

  onStatusUpdate ({ state }) {
    this.emit('state', state)
  }
}

module.exports =
  (featureId) =>
    (services) =>
      new LightFeature(featureId, services)
