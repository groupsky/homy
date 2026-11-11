const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals')

// #1696: after a restart the status must not wait for the 15-minute heartbeat.
describe('boiler-controller status at start', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const setup = (config = {}) => {
    const bot = require('./boiler-controller')('boilerController', {
      temperatureTopTopic: 'temp/top',
      boilerRelayTopic: 'relay/boiler',
      controlModeTopic: 'control/mode/set',
      ...config
    })
    const handlers = {}
    const mqtt = {
      subscribe: jest.fn((topic, cb) => { handlers[topic] = cb }),
      publish: jest.fn()
    }
    bot.start({ mqtt, persistedCache: { controlMode: 'automatic', manualOverrideExpires: null } })
    const statuses = () => mqtt.publish.mock.calls
      .filter(([topic]) => topic === 'homy/automation/boilerController/status')
      .map(([, payload]) => payload)
    return { handlers, mqtt, statuses }
  }

  test('publishes a full status 10 s after start, long before the heartbeat', () => {
    const { handlers, mqtt, statuses } = setup()
    handlers['temp/top']({ state: 50 })
    mqtt.publish.mockClear()

    jest.advanceTimersByTime(10 * 1000)

    expect(statuses()).toEqual([expect.objectContaining({
      startup: true,
      controlMode: 'automatic',
      reason: expect.any(String),
      temperatures: expect.objectContaining({ top: 50 })
    })])
  })

  test('publishes it once, even when nothing changed since start', () => {
    const { statuses } = setup()
    jest.advanceTimersByTime(14 * 60 * 1000)
    expect(statuses().filter((s) => s.startup)).toHaveLength(1)
    expect(statuses().every((s) => typeof s.reason === 'string' && s.reason)).toBe(true)
  })

  test('does not wait for the contactor status timeout', () => {
    const { statuses } = setup({ contactorStatusTopic: 'contactor/status' })
    jest.advanceTimersByTime(10 * 1000)
    expect(statuses()).toEqual([expect.objectContaining({ startup: true, reason: expect.any(String) })])
  })
})
