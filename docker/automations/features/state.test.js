const { afterEach, beforeEach, describe, expect, jest, test } = require('@jest/globals')
const createStateFeature = require('./state')

const STATUS = 'homy/features/light/test_light/status'
const COMMAND = 'homy/features/light/test_light/set'

describe('StateFeature toggle', () => {
  let subscribers
  let commands
  let feature

  const status = (state) => (subscribers[STATUS] || []).forEach((cb) => cb({ state }))

  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    subscribers = {}
    commands = []
    const mqtt = {
      subscribe: (topic, cb) => { (subscribers[topic] = subscribers[topic] || []).push(cb) },
      publish: (topic, payload) => { if (topic === COMMAND) commands.push(payload.state) },
    }
    feature = createStateFeature({ type: 'light', name: 'test_light' }, { initialState: false })({ mqtt })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('toggles at once from a known state', () => {
    status(false)
    feature.toggle({ timeout: 1000 })
    expect(commands).toEqual([true])
  })

  test('after a failed write, the next toggle waits for a fresh status and toggles from it (#1956)', () => {
    feature.toggle({ timeout: 1000 }) // writes "on"; the relay board does not answer
    expect(commands).toEqual([true])

    jest.advanceTimersByTime(4500)
    feature.toggle({ timeout: 1000 }) // the old state "off" is not trusted
    expect(commands).toEqual([true])

    status(false) // the board is back: the light is still off
    expect(commands).toEqual([true, true])
  })

  test('after a failed write, gives up when no status comes within the timeout', () => {
    feature.toggle({ timeout: 1000 })
    feature.toggle({ timeout: 1000 })
    jest.advanceTimersByTime(1001)
    status(false)
    expect(commands).toEqual([true])
  })

  test('a written command and its status: the next toggle is at once', () => {
    feature.toggle({ timeout: 1000 })
    status(true)
    feature.toggle({ timeout: 1000 })
    expect(commands).toEqual([true, false])
  })

  test('with no state yet, waits for the timeout, not 0 ms', () => {
    const unknown = createStateFeature({ type: 'light', name: 'other' }, { initialState: null })({
      mqtt: {
        subscribe: (topic, cb) => { (subscribers[topic] = subscribers[topic] || []).push(cb) },
        publish: (topic, payload) => commands.push(payload.state),
      },
    })
    unknown.toggle({ timeout: 1000 })
    jest.advanceTimersByTime(500)
    ;(subscribers['homy/features/light/other/status'] || []).forEach((cb) => cb({ state: true }))
    expect(commands).toEqual([false])
  })
})
