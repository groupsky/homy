const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = new Date('2026-11-02T10:00:00+02:00').getTime()

describe('boiler-controller vacation_until mode (#1756)', () => {
  let subscriptions
  let published
  let persistedCache

  const start = (cache = { controlMode: 'automatic', manualOverrideExpires: null }) => {
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
      controlModeTopic: 'control/mode/set'
    }).start({ mqtt, persistedCache })
  }
  const command = (payload) => subscriptions['control/mode/set'](payload)
  const lastStatus = () => published.filter((m) => m.topic === 'control/mode/status').at(-1).payload
  const lastRelay = () => published.filter((m) => m.topic === 'relay/boiler').at(-1).payload

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('is accepted with an end time in the future, and ends at that time', () => {
    start()
    command({ mode: 'vacation_until', until: NOW + 5 * DAY })

    expect(persistedCache.controlMode).toBe('vacation_until')
    expect(persistedCache.manualOverrideExpires).toBe(NOW + 5 * DAY)
    expect(lastStatus()).toEqual({ mode: 'vacation_until', manualOverrideExpires: NOW + 5 * DAY })
    expect(lastRelay()).toMatchObject({ state: false })
    expect(lastRelay().reason).toMatch(/^vacation_until/)
  })

  test('is accepted at exactly 60 days ahead', () => {
    start()
    command({ mode: 'vacation_until', until: NOW + 60 * DAY })

    expect(persistedCache.controlMode).toBe('vacation_until')
  })

  test.each([
    ['no end time', { mode: 'vacation_until' }],
    ['an end time in the past', { mode: 'vacation_until', until: NOW - 1000 }],
    ['an end time of now', { mode: 'vacation_until', until: NOW }],
    ['an end time over 60 days ahead', { mode: 'vacation_until', until: NOW + 60 * DAY + 1 }],
    ['an end time that is a text', { mode: 'vacation_until', until: '2026-12-01' }],
    ['an end time that is not finite', { mode: 'vacation_until', until: Infinity }],
    ['a plain string without end time (a pick in Home Assistant)', 'vacation_until']
  ])('is refused with %s, and the mode stays', (_, payload) => {
    start()
    command({ mode: 'vacation_3d' })
    const before = { ...persistedCache }
    command(payload)

    expect(persistedCache).toEqual(before)
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('refused'))
  })

  test('a refused command keeps an automatic mode automatic', () => {
    start()
    command({ mode: 'vacation_until', until: NOW - 1000 })

    expect(persistedCache.controlMode).toBe('automatic')
    expect(persistedCache.manualOverrideExpires).toBeNull()
  })

  test('goes back to automatic at the end time', () => {
    start()
    command({ mode: 'vacation_until', until: NOW + 2 * HOUR })
    jest.setSystemTime(NOW + 2 * HOUR + 1000)
    // Any input makes the decision, like for the other timed modes
    subscriptions['temp/top']({ state: 60, _tz: Date.now() })

    expect(persistedCache.controlMode).toBe('automatic')
    expect(persistedCache.manualOverrideExpires).toBeNull()
    expect(lastStatus().mode).toBe('automatic')
  })

  test('is restored after a restart before the end time, and dropped after it', () => {
    start({ controlMode: 'vacation_until', manualOverrideExpires: NOW + HOUR })
    expect(lastStatus().mode).toBe('vacation_until')

    start({ controlMode: 'vacation_until', manualOverrideExpires: NOW - HOUR })
    expect(persistedCache.controlMode).toBe('automatic')
  })
})
