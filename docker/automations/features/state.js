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
   * The last command, until the next status comes. A toggle computes from it,
   * not from the older status: the write may have failed (a restarting relay
   * board does not answer, and then no status follows for minutes), and
   * toggling the old status again would write the same value twice (#1956).
   * @type {any}
   */
  #command = undefined

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
    this.#command = newVal
    this.#mqtt.publish(this.commandTopic, { state: newVal }, { retain: this.#retain })
  }

  get stateTopic () {
    return `${this.baseFeatureTopic}/status`
  }

  /**
   * Switches the state to its opposite: of the last command when no status
   * came after it yet, else of the last status. When neither is known, waits
   * for the first status.
   * @param {{timeout?: number}} [options] give up waiting after this many ms; 0 waits forever
   */
  toggle ({ timeout = 0 } = {}) {
    const current = this.#command !== undefined ? this.#command : this.#state
    if (current != null) {
      this.state = !current
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
    this.#command = undefined
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
