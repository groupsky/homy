const resolve = require('../lib/resolve')
const HaLight = require('../lib/ha/light')

module.exports = (name, {
  feature: featureId,
  topic,
  config
}) => {
  const startFeature = resolve('light', 'features')(featureId)
  return ({
    start: (services) => {
      const feature = startFeature(services)
      const ha = new HaLight(topic, config)

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
}
