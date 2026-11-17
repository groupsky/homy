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

  test('after a failed write, the next toggle computes from the command, not the old state (#1956)', () => {
    feature.toggle({ timeout: 1000 }) // writes "on"; the relay board does not answer, no status follows
    jest.advanceTimersByTime(4500)
    feature.toggle({ timeout: 1000 })
    expect(commands).toEqual([true, false])
  })

  test('a status after a command wins over the command', () => {
    feature.toggle({ timeout: 1000 }) // writes "on"
    status(false) // the board reports the light still off
    feature.toggle({ timeout: 1000 })
    expect(commands).toEqual([true, true])
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
