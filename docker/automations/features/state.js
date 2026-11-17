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
   * True from a command until the next status. The command may have failed
   * (a relay board restarting does not answer), so the old state is not
   * known to be right (#1956).
   * @type {boolean}
   */
  #commandPending = false

  /**
   * @param {{name: string, type: string}} feature
   * @param {import(mqtt)}mqtt
   * @param {boolean} [autoSubscribe]
   * @param {boolean} [retain]
   * @param {boolean|null} [initialState]
   */
  constructor (feature, { mqtt }, {
    autoSubscribe = true,
    retain = false,
    initialState = null
  } = {}) {
    super()
    this.#feature = feature
    this.#mqtt = mqtt
    this.#state = initialState

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
    this.#commandPending = true
    this.#mqtt.publish(this.commandTopic, { state: newVal }, { retain: this.#retain })
  }

  get stateTopic () {
    return `${this.baseFeatureTopic}/status`
  }

  /**
   * Switches the state to its opposite. When the state is not known yet, or a
   * command has no status after it yet, waits for the next status and toggles
   * from that, so a failed write is never taken as done.
   * @param {{timeout?: number}} [options] give up after this many ms; 0 waits forever
   */
  toggle ({ timeout = 0 } = {}) {
    if (this.#state != null && !this.#commandPending) {
      this.state = !this.#state
      return
    }
    console.info('waiting for state update to toggle', timeout > 0 ? `within next ${timeout / 1000}s` : '')
    let timer
    const toggler = (state) => {
      clearTimeout(timer)
      this.state = !state
    }
    if (timeout > 0) {
      timer = setTimeout(() => {
        console.info('timed out waiting for state update to toggle')
        this.off('update', toggler)
      }, timeout)
    }
    this.once('update', toggler)
  }

  subscribe () {
    this.#mqtt.subscribe(this.stateTopic, this.#onStateMessage)
  }

  #onStateMessage = ({ state }) => {
    console.debug('state update', this.#feature, state)
    this.#commandPending = false
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
