const {describe, expect, it, jest} = require('@jest/globals')
const path = require('path')

// A retained command is handed to every new subscriber, so a reader start
// would apply the last command again, maybe hours later (#1708).
describe('relay commands from features.js', () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  const {bots} = require(path.resolve(__dirname, '../../config/automations/features.js'))
  log.mockRestore()
  const commands = Object.entries(bots)
    .filter(([, bot]) => typeof bot.output?.params?.topic === 'string' && bot.output.params.topic.endsWith('/write'))

  it('has the relay commands', () => {
    expect(commands.map(([name]) => name)).toEqual(expect.arrayContaining([
      'corridor2BothCeilingLightsCmd', 'bath1CeilingLightCmd', 'irrigationFlowerGroundCmd',
    ]))
  })

  it.each(commands)('%s is not retained', (name, bot) => {
    expect(bot.output.params.retain).not.toBe(true)
  })
})
