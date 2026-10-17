const {describe, expect, it, jest} = require('@jest/globals')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const nunjucks = require('nunjucks')
const {write} = require('./bac002')

// Home Assistant renders these command templates with Jinja; nunjucks
// renders this subset the same way.
const CLIMATE_YAML = path.join(__dirname, '../../../config/home-assistant/configuration/mqtt/climate.yaml')
const climates = yaml.load(fs.readFileSync(CLIMATE_YAML, 'utf8'))
const env = new nunjucks.Environment(null, {autoescape: false})

describe('Home Assistant fan command for BAC002', () => {
  const cases = climates
    .filter(c => c.fan_mode_command_template)
    .flatMap((c, i) => c.fan_modes.map(mode => [i, mode, c.fan_mode_command_template]))

  it('covers at least one climate entity', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it.each(cases)('climate %i: fan mode "%s" makes a payload the driver writes', async (_, mode, template) => {
    const payload = JSON.parse(env.renderString(template, {value: mode}))
    const client = {writeRegister: jest.fn().mockResolvedValue()}

    await write(client, payload)

    expect(client.writeRegister).toHaveBeenCalledWith(1, expect.any(Number))
  })
})
