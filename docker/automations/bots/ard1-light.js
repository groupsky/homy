const HaLight = require('../lib/ha/light')

const STATE_TOPIC = '/homy/ard1/input'
const COMMAND_TOPIC = '/homy/ard1/output'
const STATUS_TOPIC = '/homy/ard1/status'

module.exports = (name, {
  pin, inverted = false,
  ha: { enabled: haEnabled = false, topic: haTopic, config: haConfig } = {}
}) => ({
  start: ({ mqtt }) => {
    let state = null

    const ha = new HaLight(haTopic, haConfig)

    const setState = (newState) => {
      if (newState === state) {
        return
      }
      // emit new state
      ha.state = state = newState
    }

    const heartbeat = (counter) => {
      // TODO: handle heartbeat
    }

    mqtt.subscribe(STATE_TOPIC,
      /**
       * @param {{t: 'oc'|'ic', p: number, v: 0|1}} payload
       */
      (payload) => {
        heartbeat()
        if (payload.p !== pin || payload.t !== 'oc') return

        const newState = payload.v === (inverted ? 0 : 1)
        setState(newState)
      }
    )

    mqtt.subscribe(STATUS_TOPIC,
      /**
       * @param {{ip: string, cnt: number}} payload
       */
      (payload) => {
        heartbeat(payload.cnt)
      }
    )

    if (haEnabled) {
      ha.start({ mqtt })
      ha.on('change', (newState) => {
        mqtt.publish(COMMAND_TOPIC, { pin, value: newState ? 1 : 0 }, { retain: true })
      })
    }
  }
})
