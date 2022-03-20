const EventEmitter = require('events')

class StateFeature extends EventEmitter {
  /**
   * @type {{name: string, type: string}}
   */
  #feature
  /**
   * @type {import(mqtt)}
   */
  #mqtt

  /**
   * @type {boolean}
   */
  #retain

  /**
   * @type {any}
   */
  #state

  /**
   * @param {{name: string, type: string}} feature
   * @param {import(mqtt)}mqtt
   * @param {boolean} [autoSubscribe]
   */
  constructor (feature, { mqtt }, {
    autoSubscribe = true,
    retain = false,
  } = {}) {
    super()
    this.#feature = feature
    this.#mqtt = mqtt

    if (autoSubscribe) {
      this.subscribe()
    }
  }

  get baseFeatureTopic () {
    return `homy/features/${this.#feature.type}/${this.#feature.name}`
  }

  get commandTopic () {
    return `${this.baseFeatureTopic}/set`
  }

  get state () {
    return this.#state
  }

  set state (newVal) {
    console.debug('update state', this.#feature, newVal)
    this.#mqtt.publish(this.commandTopic, { state: newVal }, { retain: this.#retain })
  }

  get stateTopic () {
    return `${this.baseFeatureTopic}/status`
  }

  toggle ({ timeout = 0 }) {
    if (this.#state == null) {
      console.info('waiting for state update to toggle', timeout > 0 ? `within next ${timeout/1000}s` : '')
      let timer
      const toggler = () => {
        if (timer) {
          clearTimeout(timer)
        }
        this.state = !this.state
      }
      if (timeout > 0) {
        timer = setTimeout(() => {
          console.info('timed out waiting for state update to toggle')
          this.off('update', toggler)
        })
      }
      this.once('update', toggler)
    } else {
      this.state = !this.state
    }
  }

  subscribe () {
    this.#mqtt.subscribe(this.stateTopic, this.#onStateMessage)
  }

  #onStateMessage = ({ state }) => {
    console.debug('state update', this.#feature, state)
    this.emit('update', state, this.#state, this)
    if (this.#state !== state) {
      if (this.#state != null) {
        this.emit('change', state, this.#state, this)
      }
      this.#state = state
    }
  }
}

module.exports =
  (feature, opts) =>
    (services) =>
      new StateFeature(feature, services, opts)
