const { describe, expect, it, jest } = require('@jest/globals')
const path = require('path')

const configDir = path.resolve(__dirname, '../../config/automations')

// The feature bots (config.bots) and the Home Assistant discovery bots
const features = () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  try {
    return require(path.join(configDir, 'features.js')).bots
  } finally {
    log.mockRestore()
  }
}
const discovery = () => require(path.join(configDir, 'ha_discovery.js')).bots

const bitOf = (bot) => bot.transform.find((t) => t.name === 'bit_to_bool').params.bit

const byTopic = (topic) => Object.values(features())
  .find((bot) => bot.output && bot.output.params.topic.endsWith(`/${topic}/status`))

describe('cabinet windows (#1642)', () => {
  it('west window is bit 3 and south window is bit 4 of mbsl32di1', () => {
    const west = byTopic('open/cabinet_west_window_open')
    const south = byTopic('open/cabinet_south_window_open')
    expect(west.input.params.topic).toBe('/modbus/dry-switches/mbsl32di1/reading')
    expect(south.input.params.topic).toBe('/modbus/dry-switches/mbsl32di1/reading')
    expect(bitOf(west)).toBe(3)
    expect(bitOf(south)).toBe(4)
  })

  it('Home Assistant name follows the id', () => {
    const names = Object.fromEntries(Object.values(discovery())
      .map((b) => b.input.params.payload)
      .filter((p) => /^cabinet_(south|west)_window_open$/.test(p.object_id))
      .map((p) => [p.object_id, p.name]))
    expect(names).toEqual({
      cabinet_west_window_open: 'Прозорец запад',
      cabinet_south_window_open: 'Прозорец юг',
    })
  })
})
