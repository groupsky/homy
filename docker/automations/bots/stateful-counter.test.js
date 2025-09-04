const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')
const createStatefulCounter = require('./stateful-counter')

describe('stateful-counter bot', () => {
  let mockMqtt
  let mockState
  let bot
  let currentState

  beforeEach(() => {
    currentState = {}

    mockState = {
      get: jest.fn().mockImplementation((defaultState) => {
        return Promise.resolve(Object.keys(currentState).length > 0 ? currentState : defaultState)
      }),
      set: jest.fn().mockImplementation((newState) => {
        Object.assign(currentState, newState)
        return Promise.resolve()
      })
    }

    mockMqtt = {
      subscribe: jest.fn().mockImplementation((topic, callback) => {
        mockMqtt._callbacks = mockMqtt._callbacks || {}
        mockMqtt._callbacks[topic] = callback
        return Promise.resolve()
      }),
      publish: jest.fn().mockResolvedValue(),
      _triggerMessage: (topic, message) => {
        if (mockMqtt._callbacks && mockMqtt._callbacks[topic]) {
          return mockMqtt._callbacks[topic](message)
        }
      }
    }

    const config = {
      incrementTopic: '/test/increment',
      resetTopic: '/test/reset',
      statusTopic: '/test/status',
      outputTopic: '/test/output'
    }

    bot = createStatefulCounter('test-counter', config)
  })

  it('should initialize with default state', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    expect(mockState.get).toHaveBeenCalledWith({
      count: 0,
      lastReset: expect.any(String),
      totalIncrements: 0
    })
  })

  it('should subscribe to increment topic', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/increment', expect.any(Function))
  })

  it('should increment count when receiving increment message', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 1 })

    expect(mockState.set).toHaveBeenCalledWith({
      count: 1,
      lastReset: expect.any(String),
      totalIncrements: 1
    })
  })

  it('should use default increment of 1 when not specified', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/increment', {})

    expect(mockState.set).toHaveBeenCalledWith({
      count: 1,
      lastReset: expect.any(String),
      totalIncrements: 1
    })
  })

  it('should use custom increment value', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 5 })

    expect(mockState.set).toHaveBeenCalledWith({
      count: 5,
      lastReset: expect.any(String),
      totalIncrements: 1
    })
  })

  it('should publish output when outputTopic is configured', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 3 })

    expect(mockMqtt.publish).toHaveBeenCalledWith('/test/output', {
      count: 3,
      totalIncrements: 1,
      botName: 'test-counter'
    })
  })

  it('should reset count when receiving reset message', async () => {
    currentState = { count: 10, totalIncrements: 5, lastReset: '2023-01-01T00:00:00.000Z' }

    await bot.start({ mqtt: mockMqtt, state: mockState })
    await mockMqtt._triggerMessage('/test/reset', {})

    expect(mockState.set).toHaveBeenCalledWith({
      count: 0,
      lastReset: expect.any(String),
      totalIncrements: 5
    })
  })

  it('should preserve totalIncrements across resets', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/increment', {})
    await mockMqtt._triggerMessage('/test/increment', {})
    await mockMqtt._triggerMessage('/test/reset', {})

    expect(mockState.set).toHaveBeenLastCalledWith({
      count: 0,
      lastReset: expect.any(String),
      totalIncrements: 2
    })
  })

  it('should publish reset confirmation', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/reset', {})

    expect(mockMqtt.publish).toHaveBeenCalledWith('/test/output', {
      count: 0,
      lastReset: expect.any(String),
      totalIncrements: 0,
      botName: 'test-counter',
      action: 'reset'
    })
  })

  it('should handle status requests', async () => {
    currentState = { count: 42, totalIncrements: 100, lastReset: '2023-01-01T00:00:00.000Z' }

    await bot.start({ mqtt: mockMqtt, state: mockState })
    await mockMqtt._triggerMessage('/test/status', {})

    expect(mockMqtt.publish).toHaveBeenCalledWith('/test/output', {
      count: 42,
      totalIncrements: 100,
      lastReset: '2023-01-01T00:00:00.000Z',
      botName: 'test-counter',
      action: 'status'
    })
  })

  it('should work without optional topics configured', async () => {
    const minimalConfig = {
      incrementTopic: '/test/increment'
    }
    const minimalBot = createStatefulCounter('minimal-counter', minimalConfig)

    await expect(minimalBot.start({ mqtt: mockMqtt, state: mockState })).resolves.not.toThrow()

    expect(mockMqtt.subscribe).toHaveBeenCalledTimes(1)
    expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/increment', expect.any(Function))
  })

  it('should accumulate count across multiple increments', async () => {
    await bot.start({ mqtt: mockMqtt, state: mockState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 5 })
    await mockMqtt._triggerMessage('/test/increment', { increment: 3 })
    await mockMqtt._triggerMessage('/test/increment', { increment: 2 })

    expect(mockState.set).toHaveBeenLastCalledWith({
      count: 10,
      lastReset: expect.any(String),
      totalIncrements: 3
    })
  })
})
