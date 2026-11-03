const {describe, expect, it} = require('@jest/globals')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const nunjucks = require('nunjucks')

// The oven's Bulgarian MQTT entities in Home Assistant (#1907). They live in
// the HA config, not in this service; the test is here because this package
// already renders HA templates with nunjucks (the Jinja subset they use).
const MQTT = path.join(__dirname, '../../../config/home-assistant/configuration/mqtt')
const load = name => yaml.load(fs.readFileSync(path.join(MQTT, name), 'utf8'))
const selects = load('selects.yaml')
const sensors = load('sensors.yaml')
const binarySensors = load('binary_sensors.yaml')

const env = new nunjucks.Environment(null, {autoescape: false})
env.addFilter('tojson', v => JSON.stringify(v))
const render = (template, value) => env.renderString(template, {value})

// Every program the oven offers, from the hcpy bridge's device description
// (2026-11-03). hcpy publishes the last part of the key as the state.
const PROGRAM_KEYS = [
  'Cooking.Oven.Program.Cleaning.Pyrolysis',
  'Cooking.Oven.Program.Dish.Automatic.Conv.BeefRoulade',
  'Cooking.Oven.Program.Dish.Automatic.Conv.BonelessLegOfLambMedium',
  'Cooking.Oven.Program.Dish.Automatic.Conv.BonelessLegOfLambWellDone',
  'Cooking.Oven.Program.Dish.Automatic.Conv.BonelessLegOfVenison',
  'Cooking.Oven.Program.Dish.Automatic.Conv.BonelessPorkNeckJoint',
  'Cooking.Oven.Program.Dish.Automatic.Conv.ChickenParts',
  'Cooking.Oven.Program.Dish.Automatic.Conv.FrozenDeepPanPizza',
  'Cooking.Oven.Program.Dish.Automatic.Conv.FrozenLasagne',
  'Cooking.Oven.Program.Dish.Automatic.Conv.FrozenThinCrustPizza',
  'Cooking.Oven.Program.Dish.Automatic.Conv.Goulash',
  'Cooking.Oven.Program.Dish.Automatic.Conv.JointOfPorkWithCrackling',
  'Cooking.Oven.Program.Dish.Automatic.Conv.JointOfVealLean',
  'Cooking.Oven.Program.Dish.Automatic.Conv.JointOfVealMarbled',
  'Cooking.Oven.Program.Dish.Automatic.Conv.MeatLoafMadeFromFreshMincedMeat',
  'Cooking.Oven.Program.Dish.Automatic.Conv.PartCookedBreadRollsOrBaguette',
  'Cooking.Oven.Program.Dish.Automatic.Conv.PastaBake',
  'Cooking.Oven.Program.Dish.Automatic.Conv.PommesFrites',
  'Cooking.Oven.Program.Dish.Automatic.Conv.PorkNeckJoint',
  'Cooking.Oven.Program.Dish.Automatic.Conv.PotRoastedBeef',
  'Cooking.Oven.Program.Dish.Automatic.Conv.PotatoGratin',
  'Cooking.Oven.Program.Dish.Automatic.Conv.SirloinMedium',
  'Cooking.Oven.Program.Dish.Automatic.Conv.StewWithMeat',
  'Cooking.Oven.Program.Dish.Automatic.Conv.StewWithVegetables',
  'Cooking.Oven.Program.Dish.Automatic.Conv.TurkeyBreast',
  'Cooking.Oven.Program.Dish.Automatic.Conv.UnstuffedChicken',
  'Cooking.Oven.Program.Dish.Automatic.Conv.UnstuffedDuck',
  'Cooking.Oven.Program.Dish.Automatic.Conv.UnstuffedGoose',
  'Cooking.Oven.Program.Dish.Automatic.Conv.WholeBakedPotatoes',
  'Cooking.Oven.Program.Dish.Automatic.Conv.WholeFish',
  'Cooking.Oven.Program.Dish.Automatic.Conv.WholeRabbit',
  'Cooking.Oven.Program.Dish.SubsequentCooking',
  'Cooking.Oven.Program.HeatingMode.3DHotAir',
  'Cooking.Oven.Program.HeatingMode.AirFry',
  'Cooking.Oven.Program.HeatingMode.BottomHeating',
  'Cooking.Oven.Program.HeatingMode.Defrost',
  'Cooking.Oven.Program.HeatingMode.GrillLargeArea',
  'Cooking.Oven.Program.HeatingMode.HotAirGentle',
  'Cooking.Oven.Program.HeatingMode.HotAirGrilling',
  'Cooking.Oven.Program.HeatingMode.LetRest',
  'Cooking.Oven.Program.HeatingMode.PizzaSetting',
  'Cooking.Oven.Program.HeatingMode.PreHeating',
  'Cooking.Oven.Program.HeatingMode.SabbathProgramme',
  'Cooking.Oven.Program.HeatingMode.SlowCook',
  'Cooking.Oven.Program.HeatingMode.TopBottomHeating',
]
const short = key => key.split('.').pop()

describe('oven program selects', () => {
  const selected = selects.find(s => s.name === 'oven_selected_program')
  const active = selects.find(s => s.name === 'oven_active_program')

  it('have both entities with the same options', () => {
    expect(selected).toBeDefined()
    expect(active).toBeDefined()
    expect(active.options).toEqual(selected.options)
    expect(new Set(selected.options).size).toBe(selected.options.length)
  })

  it('have one option for each program of the oven', () => {
    expect(selected.options).toHaveLength(PROGRAM_KEYS.length)
  })

  it.each(PROGRAM_KEYS)('%s: the state is an option and the command sends the full key back', key => {
    for (const s of [selected, active]) {
      const option = render(s.value_template, short(key))
      expect(selected.options).toContain(option)
      expect(JSON.parse(render(s.command_template, option))).toEqual([{program: key, options: []}])
    }
  })

  it('shows Bulgarian names from the manual', () => {
    expect(render(selected.value_template, '3DHotAir')).toBe('3D горещ въздух')
    expect(render(selected.value_template, 'Pyrolysis')).toBe('Пиролиза')
  })

  it('keeps an unknown key and None as they are', () => {
    expect(render(selected.value_template, 'SomethingNew')).toBe('SomethingNew')
    expect(render(selected.value_template, 'None')).toBe('None')
  })

  it('no full key is part of another one (hcpy matches by substring)', () => {
    for (const a of PROGRAM_KEYS) {
      for (const b of PROGRAM_KEYS) {
        if (a !== b) expect(b.includes(a)).toBe(false)
      }
    }
  })

  it('puts the manual text in the описание attribute', () => {
    const attrs = value => JSON.parse(render(selected.json_attributes_template, value))
    expect(attrs('3DHotAir')).toEqual({описание: 'Печене и пържене на едно или няколко нива.'})
    expect(attrs('LetRest')).toEqual({описание: 'Няма описание в ръководството'})
    expect(attrs('None')).toEqual({описание: ''})
  })

  it('never publish retained', () => {
    expect(selected.retain).toBe(false)
    expect(active.retain).toBe(false)
  })
})

describe('oven availability', () => {
  const oven = [...selects, ...sensors, ...binarySensors].filter(e => String(e.state_topic).startsWith('homeconnect/'))

  it.each(oven.map(e => [e.name, e]))('%s depends only on the LWT topics', (_, e) => {
    expect(e.availability_mode).toBe('all')
    expect(e.availability.map(a => a.topic)).toEqual(['homeconnect/LWT', 'homeconnect/oven/LWT'])
  })
})

describe('oven state text', () => {
  const sensor = name => sensors.find(s => s.name === name)

  it.each([
    ['oven_operation_state', 'Run', 'Работи'],
    ['oven_operation_state', 'Finished', 'Приключи'],
    ['oven_door_state', 'Open', 'Отворена'],
    ['oven_power_state', 'Standby', 'В готовност'],
    ['oven_door_state', 'Ajar', 'Ajar'],
  ])('%s: %s shows as %s', (name, value, text) => {
    expect(render(sensor(name).value_template, value)).toBe(text)
  })

  it('an event is ON only while present', () => {
    const event = binarySensors.find(s => s.name === 'oven_program_finished')
    expect(env.renderString(event.value_template, {value_json: {event_type: 'Present'}})).toBe('ON')
    expect(env.renderString(event.value_template, {value_json: {event_type: 'Confirmed'}})).toBe('OFF')
    expect(env.renderString(event.value_template, {value_json: {event_type: 'Off'}})).toBe('OFF')
  })
})
