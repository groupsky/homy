const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const path = require('path')
const transform = require('./transform')

const INPUT = '/modbus/dry-switches/mbsl32di1/reading'
const OUTPUT = 'homy/features/open/bath1_door_open/status'

// A contact on bit 6 that reads 1 when closed, as the drySwitch features build it.
const contactBot = (extra = {}) => transform('bath1DoorOpenState', {
  input: {name: 'inputs/mqtt', params: {topic: INPUT}},
  transform: [
    {name: 'get_object_key', params: {key: 'inputs'}},
    {name: 'bit_to_bool', params: {bit: 6}},
    'not',
    'to_state',
  ],
  filterOutput: 'state_not_null',
  output: {name: 'outputs/mqtt', params: {topic: OUTPUT, retain: true}},
  ...extra,
})

const CLOSED = {inputs: 1 << 6}
const OPEN = {inputs: 0}
// Another bit of the same module changed; the contact did not.
const OPEN_OTHER_BIT = {inputs: 1 << 7}

describe('transform bot', () => {
  let mqtt
  let send

  const published = () => mqtt.publish.mock.calls.map(([, payload]) => payload.state)

  beforeEach(() => {
    jest.useFakeTimers()
    mqtt = {
      subscribe: jest.fn((topic, cb) => { send = cb }),
      publish: jest.fn(),
    }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('without debounceMs', () => {
    it('publishes every change at once', () => {
      contactBot().start({mqtt})

      send(CLOSED)
      send(OPEN)
      send(CLOSED)

      expect(published()).toEqual([false, true, false])
      expect(mqtt.publish).toHaveBeenCalledWith(OUTPUT, {state: false}, {content: 'json', qos: 0, retain: true})
    })
  })

  describe('with debounceMs: 2000', () => {
    beforeEach(() => {
      contactBot({debounceMs: 2000}).start({mqtt})
    })

    it('publishes the first value at once', () => {
      send(CLOSED)

      expect(published()).toEqual([false])
    })

    it('ignores a change shorter than 2 s', () => {
      send(CLOSED)
      send(OPEN)
      jest.advanceTimersByTime(1999)
      send(CLOSED)
      jest.advanceTimersByTime(10000)

      expect(published()).not.toContain(true)
      expect(published()).toEqual([false, false])
    })

    it('passes a change that lasts 2 s, once', () => {
      send(CLOSED)
      send(OPEN)
      jest.advanceTimersByTime(1999)
      expect(published()).toEqual([false])

      jest.advanceTimersByTime(1)
      expect(published()).toEqual([false, true])

      jest.advanceTimersByTime(10000)
      expect(published()).toEqual([false, true])
    })

    it('times the change from its start when other bits of the module change', () => {
      send(CLOSED)
      send(OPEN)
      jest.advanceTimersByTime(1000)
      send(OPEN_OTHER_BIT)
      jest.advanceTimersByTime(1000)

      expect(published()).toEqual([false, true])
    })

    it('ends in the right state when a chattering contact stays changed', () => {
      send(CLOSED)
      for (let i = 0; i < 5; i++) {
        send(OPEN)
        jest.advanceTimersByTime(300)
        send(CLOSED)
        jest.advanceTimersByTime(300)
      }
      send(OPEN)
      jest.advanceTimersByTime(2000)

      expect(published()).not.toContain(undefined)
      expect(published().at(-1)).toBe(true)
      expect(published().filter(state => state === true)).toHaveLength(1)
    })
  })
})

describe('features config', () => {
  const {bots} = require(path.resolve(__dirname, '../../../config/automations/features.js'))

  it('debounces bath1DoorOpen and bath2WindowOpen by 2 s', () => {
    expect(bots.bath1DoorOpenState.debounceMs).toBe(2000)
    expect(bots.bath2WindowOpenState.debounceMs).toBe(2000)
  })

  it('does not debounce any other input', () => {
    const debounced = Object.entries(bots)
      .filter(([, bot]) => bot.debounceMs)
      .map(([name]) => name)

    expect(debounced.sort()).toEqual(['bath1DoorOpenState', 'bath2WindowOpenState'])
  })
})
