const {describe, expect, it, jest} = require('@jest/globals')
const path = require('path')

const configDir = path.resolve(__dirname, '../../config/automations')

// Home Assistant builds an entity from its discovery message. Without retain
// the broker forgets it, so after a restart of HA or of the broker the entity
// stays unavailable until this service publishes it again (#1712).
describe('Home Assistant discovery from config.js', () => {
  const {bots} = require(path.join(configDir, 'config.js'))
  const discovery = Object.entries(bots)
    .filter(([, bot]) => typeof bot.topic === 'string' && bot.topic.startsWith('homeassistant/'))

  it('has the boiler discovery messages', () => {
    expect(discovery.map(([, bot]) => bot.topic)).toEqual(expect.arrayContaining([
      'homeassistant/sensor/boiler-energy-meter/config',
      'homeassistant/binary_sensor/boiler-heating/config',
    ]))
  })

  it.each(discovery)('%s is published with retain', (name, bot) => {
    const publish = jest.fn()
    require(`./bots/${bot.type}`)(name, bot).start({mqtt: {publish}})

    expect(publish).toHaveBeenCalledWith(bot.topic, bot.payload, expect.objectContaining({retain: true}))
  })
})
