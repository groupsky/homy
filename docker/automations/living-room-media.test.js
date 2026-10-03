const { beforeEach, describe, expect, test } = require('@jest/globals')
const path = require('path')
const contentProcessors = require('./lib/content-processors')

/**
 * Checks the living-room volume and TV power bots as they are deployed, by
 * loading config/automations/config.js and wiring each bot to a fake broker.
 *
 * Volume goes to the media computer, whose agent subscribes to
 * homy/media/living/volume/command and expects a bare `up` or `down`. That
 * contract is shared with code outside this repo, so the tests pin the exact
 * wire payload, not just the value handed to publish.
 */

const configDir = path.resolve(__dirname, '../../config/automations')
const volumeCommandTopic = 'homy/media/living/volume/command'
const volumeStateTopic = 'homy/media/living/volume/state'
const irTopic = 'z2m/house1/ir-living/set/ir_code_to_send'

const createBroker = () => {
  const subscribers = {}
  const published = []
  return {
    published,
    mqtt: {
      subscribe: async (topic, callback) => {
        (subscribers[topic] = subscribers[topic] || []).push(callback)
      },
      // Serializes the way index.js does, so `published` holds what the broker sees
      publish: async (topic, payload, { content = 'json', retain = false } = {}) => {
        published.push({ topic, payload: contentProcessors[content].write(payload, { _bot: 'test' }), retain })
      }
    },
    deliver: (topic, payload) => (subscribers[topic] || []).forEach((callback) => callback(payload))
  }
}

const startBot = (botsConfig, name, broker) => {
  const botConfig = botsConfig[name]
  const bot = require(`./bots/${botConfig.type}`)(name, botConfig)
  return bot.start({ mqtt: broker.mqtt })
}

describe('living-room volume and TV power', () => {
  let bots
  let tvLivingIrPower
  let broker

  beforeEach(() => {
    bots = require(path.join(configDir, 'config.js')).bots
    broker = createBroker()
    tvLivingIrPower = bots.tvLivingPowerFromButton.transform()
  })

  describe.each([
    ['tvLivingVolumeUpFromButton', 'homy/features/button/living_main_up/status', 'up'],
    ['tvLivingVolumeDownFromButton', 'homy/features/button/living_main_down/status', 'down'],
  ])('%s (wall switch)', (name, inputTopic, command) => {
    beforeEach(() => startBot(bots, name, broker))

    test(`publishes one bare "${command}" to the media computer per press`, () => {
      broker.deliver(inputTopic, { state: true })

      expect(broker.published).toEqual([{ topic: volumeCommandTopic, payload: command, retain: false }])
    })

    test('publishes nothing on release', () => {
      broker.deliver(inputTopic, { state: false })

      expect(broker.published).toEqual([])
    })

    test('sends no IR code', () => {
      broker.deliver(inputTopic, { state: true })
      broker.deliver(inputTopic, { state: false })

      expect(broker.published.filter(({ topic }) => topic === irTopic)).toEqual([])
    })
  })

  describe.each([
    ['tvLivingVolumeUpFromHA', 'homy/features/button/tv_living_volume_up/trigger', 'up'],
    ['tvLivingVolumeDownFromHA', 'homy/features/button/tv_living_volume_down/trigger', 'down'],
  ])('%s (HA button)', (name, inputTopic, command) => {
    beforeEach(() => startBot(bots, name, broker))

    test(`publishes one bare "${command}" to the media computer per press, and no IR code`, () => {
      // what HA sends: payload_press from the button's discovery config
      broker.deliver(inputTopic, { _src: 'ha' })

      expect(broker.published).toEqual([{ topic: volumeCommandTopic, payload: command, retain: false }])
    })
  })

  describe('TV power stays on IR', () => {
    test('the IR power code is the one kept for the TV', () => {
      expect(tvLivingIrPower).toMatch(/^[A-Za-z0-9+/=]{40,}$/)
    })

    test('wall switch left sends the IR power code', () => {
      startBot(bots, 'tvLivingPowerFromButton', broker)

      broker.deliver('homy/features/button/living_main_left/status', { state: true })
      broker.deliver('homy/features/button/living_main_left/status', { state: false })

      expect(broker.published).toEqual([{ topic: irTopic, payload: tvLivingIrPower, retain: false }])
    })

    test('HA power button sends the IR power code', () => {
      startBot(bots, 'tvLivingPowerFromHA', broker)

      broker.deliver('homy/features/button/tv_living_power/trigger', { _src: 'ha' })

      expect(broker.published).toEqual([{ topic: irTopic, payload: tvLivingIrPower, retain: false }])
    })
  })
})

describe('living-room volume in Home Assistant discovery', () => {
  let bots

  beforeEach(() => {
    bots = require(path.join(configDir, 'ha_discovery.js')).bots
  })

  const discoveryPayload = (name) => bots[`${name}HaDiscovery`].input.params.payload

  test.each([
    ['tvLivingVolumeUp', 'tv_living_volume_up', 'Living Volume Up'],
    ['tvLivingVolumeDown', 'tv_living_volume_down', 'Living Volume Down'],
  ])('%s drops "TV" from its name and keeps its entity and command topic', (name, feature, label) => {
    expect(discoveryPayload(name)).toMatchObject({
      name: label,
      unique_id: `homy_button_${feature}`,
      object_id: feature,
      default_entity_id: `button.${feature}`,
      command_topic: `homy/features/button/${feature}/trigger`,
    })
  })

  test('TV power button is unchanged', () => {
    expect(discoveryPayload('tvLivingPower')).toMatchObject({
      name: 'TV Power',
      unique_id: 'homy_button_tv_living_power',
      command_topic: 'homy/features/button/tv_living_power/trigger',
    })
  })

  test('volume level is a read-only sensor on the state topic the media computer retains', () => {
    const payload = discoveryPayload('livingVolume')

    expect(payload).toMatchObject({
      state_topic: volumeStateTopic,
      value_template: '{{ value_json.volume }}',
      json_attributes_topic: volumeStateTopic,
      unit_of_measurement: '%',
      unique_id: 'homy_living_volume',
      default_entity_id: 'sensor.living_volume',
    })
    expect(payload).not.toHaveProperty('command_topic')
    expect(bots.livingVolumeHaDiscovery.output.params.topic).toBe('homeassistant/sensor/living_volume/config')
  })
})
