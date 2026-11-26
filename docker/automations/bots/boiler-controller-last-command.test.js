const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals')
const path = require('path')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = new Date('2026-11-19T19:04:00+02:00').getTime()
const STATUS = 'control/mode/status'

// Every mode command gets a result in `lastCommand` on the mode status (#1975)
describe('boiler-controller lastCommand (#1975)', () => {
  let subscriptions
  let published
  let persistedCache

  const start = (cache = { controlMode: 'automatic', manualOverrideExpires: null }, config = {}) => {
    subscriptions = {}
    published = []
    persistedCache = cache
    const mqtt = {
      subscribe: jest.fn((topic, callback) => { subscriptions[topic] = callback }),
      publish: jest.fn((topic, payload) => { published.push({ topic, payload }) })
    }
    require('./boiler-controller')('test', {
      temperatureTopTopic: 'temp/top',
      boilerRelayTopic: 'relay/boiler',
      controlModeTopic: 'control/mode/set',
      hotWaterLimit: 55,
      ...config
    }).start({ mqtt, persistedCache })
  }
  const command = (payload) => subscriptions['control/mode/set'](payload)
  const top = (state) => subscriptions['temp/top']({ state, _tz: Date.now() })
  const statuses = () => published.filter((m) => m.topic === STATUS).map((m) => m.payload)
  const lastStatus = () => statuses().at(-1)
  const lastRelay = () => published.filter((m) => m.topic === 'relay/boiler').at(-1).payload
  // The distinct results published since `from` (a status may go out more
  // than once for one command, always with the same result).
  const resultsSince = (from) => [...new Set(statuses().slice(from).map((s) => s.lastCommand))].filter(Boolean)

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('the status has no result before the first command', () => {
    start()
    expect(lastStatus()).toEqual({ mode: 'automatic', manualOverrideExpires: null, lastCommand: null })
  })

  describe('boost', () => {
    test.each([60, 61.5])('is refused with the top at %s °C: the mode does not change', (value) => {
      start()
      top(value)
      const relayBefore = lastRelay()
      const from = statuses().length
      command({ mode: 'boost', _src: 'ha' })

      expect(persistedCache.controlMode).toBe('automatic')
      expect(persistedCache.manualOverrideExpires).toBeNull()
      expect(lastStatus()).toEqual({
        mode: 'automatic',
        manualOverrideExpires: null,
        lastCommand: { mode: 'boost', result: 'refused', reason: 'top_at_limit', top: value, bottom: null, limit: 60, bottomTarget: 50, at: NOW }
      })
      // One status, one result, and no new heater command
      expect(statuses().length).toBe(from + 1)
      expect(lastRelay()).toBe(relayBefore)
    })

    test('refused, it keeps a timed mode and its end time', () => {
      start()
      top(50)
      command('manual_off')
      const expires = persistedCache.manualOverrideExpires
      top(60)
      command('boost')

      expect(persistedCache).toMatchObject({ controlMode: 'manual_off', manualOverrideExpires: expires })
      expect(lastStatus()).toMatchObject({
        mode: 'manual_off',
        manualOverrideExpires: expires,
        lastCommand: { mode: 'boost', result: 'refused', reason: 'top_at_limit' }
      })
    })

    test('is applied under the limit and heats', () => {
      start()
      top(59.9)
      const from = statuses().length
      command('boost')

      expect(persistedCache.controlMode).toBe('boost')
      expect(lastRelay()).toMatchObject({ state: true, reason: 'manual_boost' })
      expect(resultsSince(from)).toEqual([
        { mode: 'boost', result: 'applied', reason: 'ok', top: 59.9, bottom: null, limit: 60, bottomTarget: 50, at: NOW }
      ])
      expect(lastStatus()).toMatchObject({ mode: 'boost', manualOverrideExpires: NOW + 2 * HOUR })
    })

    test('is applied without a top reading (the old readings rule decides)', () => {
      start()
      command('boost')

      expect(persistedCache.controlMode).toBe('boost')
      expect(lastStatus().lastCommand).toEqual({ mode: 'boost', result: 'applied', reason: 'ok', top: null, bottom: null, limit: 60, bottomTarget: 50, at: NOW })
    })

    test('the result stays when the boost ends at the limit later', () => {
      start()
      top(50)
      command('boost')
      jest.advanceTimersByTime(60 * 1000)
      top(60)

      expect(lastStatus().mode).toBe('automatic')
      expect(lastStatus().lastCommand).toMatchObject({ mode: 'boost', result: 'applied', at: NOW })
    })
  })

  describe('manual_on', () => {
    test('at the limit is applied, with reason top_at_limit; the element stays off', () => {
      start()
      top(60.1)
      const from = statuses().length
      command('manual_on')

      expect(persistedCache.controlMode).toBe('manual_on')
      expect(lastRelay()).toMatchObject({ state: false })
      expect(lastRelay().reason).toMatch(/^manual_on_limit_reached/)
      expect(resultsSince(from)).toEqual([
        { mode: 'manual_on', result: 'applied', reason: 'top_at_limit', top: 60.1, bottom: null, limit: 60, bottomTarget: 50, at: NOW }
      ])
    })

    test('under the limit is applied with reason ok', () => {
      start()
      top(43)
      command({ mode: 'manual_on', duration: HOUR })

      expect(lastRelay()).toMatchObject({ state: true })
      expect(lastStatus().lastCommand).toEqual({ mode: 'manual_on', result: 'applied', reason: 'ok', top: 43, bottom: null, limit: 60, bottomTarget: 50, at: NOW })
    })
  })

  test.each(['automatic', 'manual_off', 'vacation_3d'])('%s is applied with reason ok, even at the limit', (mode) => {
    start()
    top(60)
    command(mode)

    expect(persistedCache.controlMode).toBe(mode)
    expect(lastStatus().lastCommand).toEqual({ mode, result: 'applied', reason: 'ok', top: 60, bottom: null, limit: 60, bottomTarget: 50, at: NOW })
  })

  test('vacation_until with a valid time is applied', () => {
    start()
    command({ mode: 'vacation_until', until: NOW + 5 * DAY })

    expect(lastStatus().lastCommand).toMatchObject({ mode: 'vacation_until', result: 'applied', reason: 'ok' })
  })

  test.each([
    ['no time', { mode: 'vacation_until' }],
    ['a time in the past', { mode: 'vacation_until', until: NOW - 1000 }],
    ['a plain string (a pick in Home Assistant)', 'vacation_until']
  ])('vacation_until with %s is refused with reason invalid_until; the mode stays', (_, payload) => {
    start()
    top(50)
    command('manual_off')
    const before = { ...persistedCache }
    const from = statuses().length
    command(payload)

    expect(persistedCache).toEqual(before)
    expect(statuses().length).toBe(from + 1)
    expect(lastStatus()).toMatchObject({
      mode: 'manual_off',
      lastCommand: { mode: 'vacation_until', result: 'refused', reason: 'invalid_until', top: 50, bottom: null, limit: 60, bottomTarget: 50, at: NOW }
    })
  })

  test.each([
    ['an unknown mode', 'turbo', 'turbo'],
    ['an object with an unknown mode', { mode: 'turbo' }, 'turbo'],
    ['an object without a mode', { duration: 1000 }, null],
    ['a mode that is not a text', { mode: 42 }, null]
  ])('%s is refused with reason unknown_mode; the mode stays', (_, payload, mode) => {
    start()
    top(50)
    const from = statuses().length
    command(payload)

    expect(persistedCache.controlMode).toBe('automatic')
    expect(statuses().length).toBe(from + 1)
    expect(lastStatus()).toEqual({
      mode: 'automatic',
      manualOverrideExpires: null,
      lastCommand: { mode, result: 'refused', reason: 'unknown_mode', top: 50, bottom: null, limit: 60, bottomTarget: 50, at: NOW }
    })
  })

  test('a long unknown mode is cut to 64 characters', () => {
    start()
    command('x'.repeat(500))
    expect(lastStatus().lastCommand.mode).toBe('x'.repeat(64))
  })

  test('the result goes out with later statuses', () => {
    start()
    top(60)
    command('boost')
    const result = lastStatus().lastCommand
    jest.advanceTimersByTime(10 * 60 * 1000)
    top(40)

    expect(lastStatus().lastCommand).toEqual(result)
  })
})

describe('Home Assistant sensor for the last mode command (#1975)', () => {
  test('is on the boiler device and reads the mode status', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const discovery = require(path.resolve(__dirname, '../../../config/automations/ha_discovery.js')).bots
    const bot = discovery.boilerControllerLastCommandHaDiscovery
    expect(bot).toBeDefined()
    const payload = bot.input.params.payload
    expect(payload).toMatchObject({
      state_topic: 'homy/features/control_mode/boiler_controller/status',
      json_attributes_topic: 'homy/features/control_mode/boiler_controller/status',
      json_attributes_template: '{{ (value_json.lastCommand or {}) | tojson }}',
      device: { identifiers: 'boiler_eldom_200l' },
      unique_id: 'homy_boiler_controller_last_command',
      default_entity_id: 'sensor.boiler_controller_last_command'
    })
    // A sentence for each result and reason
    for (const word of ['refused', 'top_at_limit', 'bottom_at_target', 'invalid_until', 'unknown_mode']) {
      expect(payload.value_template).toContain(word)
    }
  })
})
