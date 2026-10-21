const { beforeEach, describe, expect, it, jest } = require('@jest/globals')
const path = require('path')

const configDir = path.resolve(__dirname, '../../config/automations')
const SET = 'homy/features/switch/dark_sky_tonight/set'
const STATUS = 'homy/features/switch/dark_sky_tonight/status'

describe('dark sky switch wiring', () => {
  let features
  let config
  let discovery

  beforeEach(() => {
    // features.js prints its config
    jest.spyOn(console, 'log').mockImplementation(() => {})
    features = require(path.join(configDir, 'features.js')).bots
    config = require(path.join(configDir, 'config.js')).bots
    discovery = require(path.join(configDir, 'ha_discovery.js')).bots
  })

  it.each(['nightExternalLights', 'nightExternalLightsZ2M'])('%s reads and resets the switch', (name) => {
    expect(config[name]).toMatchObject({ holdOffStatusTopic: STATUS, holdOffSetTopic: SET })
  })

  it('turns a set command into a retained status', () => {
    const publish = jest.fn()
    const subscribe = jest.fn()
    const bot = features.darkSkyTonightState
    const run = require(`./bots/${bot.type}`)('darkSkyTonightState', bot).start({ mqtt: { publish, subscribe } })
    expect(run).toBeUndefined()
    expect(subscribe).toHaveBeenCalledWith(SET, expect.any(Function))

    subscribe.mock.calls[0][1]({ state: true, _src: 'ha' })
    expect(publish).toHaveBeenCalledWith(STATUS, { state: true }, expect.objectContaining({ retain: true }))
  })

  it('ignores a set command without a state', () => {
    const publish = jest.fn()
    const subscribe = jest.fn()
    const bot = features.darkSkyTonightState
    require(`./bots/${bot.type}`)('darkSkyTonightState', bot).start({ mqtt: { publish, subscribe } })

    subscribe.mock.calls[0][1]({ _src: 'ha' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('is a switch in Home Assistant on the same feature topics', () => {
    const payload = discovery.darkSkyTonightHaDiscovery.input.params.payload
    expect(payload).toMatchObject({
      name: 'Тъмно небе тази нощ',
      icon: 'mdi:weather-night',
      command_topic: SET,
      state_topic: STATUS,
      default_entity_id: 'switch.dark_sky_tonight'
    })
    expect(JSON.parse(payload.payload_on)).toMatchObject({ state: true })
    expect(JSON.parse(payload.payload_off)).toMatchObject({ state: false })
  })
})
