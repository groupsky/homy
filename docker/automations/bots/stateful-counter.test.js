const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')
const createStatefulCounter = require('./stateful-counter')

describe('stateful-counter bot', () => {
  let mockMqtt
  let mockCreatePersistedState
  let bot
  let reactiveState

  beforeEach(() => {
    reactiveState = {}

    mockCreatePersistedState = jest.fn().mockImplementation((defaultState) => {
      // Initialize with default state if empty, otherwise use existing state
      if (Object.keys(reactiveState).length === 0) {
        Object.assign(reactiveState, defaultState)
      }
      return Promise.resolve(reactiveState)
    })

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
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    expect(mockCreatePersistedState).toHaveBeenCalledWith({
      count: 0,
      lastReset: expect.any(String),
      totalIncrements: 0
    })
  })

  it('should subscribe to increment topic', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/increment', expect.any(Function))
  })

  it('should increment count when receiving increment message', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 1 })

    expect(reactiveState.count).toBe(1)
    expect(reactiveState.totalIncrements).toBe(1)
  })

  it('should use default increment of 1 when not specified', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    await mockMqtt._triggerMessage('/test/increment', {})

    expect(reactiveState.count).toBe(1)
    expect(reactiveState.totalIncrements).toBe(1)
  })

  it('should use custom increment value', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 5 })

    expect(reactiveState.count).toBe(5)
    expect(reactiveState.totalIncrements).toBe(1)
  })

  it('should publish output when outputTopic is configured', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 3 })

    expect(mockMqtt.publish).toHaveBeenCalledWith('/test/output', {
      count: 3,
      totalIncrements: 1,
      botName: 'test-counter'
    })
  })

  it('should reset count when receiving reset message', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    // Set up the state first
    reactiveState.count = 10
    reactiveState.totalIncrements = 5
    reactiveState.lastReset = '2023-01-01T00:00:00.000Z'

    await mockMqtt._triggerMessage('/test/reset', {})

    expect(reactiveState.count).toBe(0)
    expect(reactiveState.totalIncrements).toBe(5)
    expect(reactiveState.lastReset).not.toBe('2023-01-01T00:00:00.000Z')
  })

  it('should preserve totalIncrements across resets', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    await mockMqtt._triggerMessage('/test/increment', {})
    await mockMqtt._triggerMessage('/test/increment', {})
    await mockMqtt._triggerMessage('/test/reset', {})

    expect(reactiveState.count).toBe(0)
    expect(reactiveState.totalIncrements).toBe(2)
  })

  it('should publish reset confirmation', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

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
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    // Set up the state first
    reactiveState.count = 42
    reactiveState.totalIncrements = 100
    reactiveState.lastReset = '2023-01-01T00:00:00.000Z'

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

    await expect(minimalBot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })).resolves.not.toThrow()

    expect(mockMqtt.subscribe).toHaveBeenCalledTimes(1)
    expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/increment', expect.any(Function))
  })

  it('should accumulate count across multiple increments', async () => {
    await bot.start({ mqtt: mockMqtt, createPersistedState: mockCreatePersistedState })

    await mockMqtt._triggerMessage('/test/increment', { increment: 5 })
    await mockMqtt._triggerMessage('/test/increment', { increment: 3 })
    await mockMqtt._triggerMessage('/test/increment', { increment: 2 })

    expect(reactiveState.count).toBe(10)
    expect(reactiveState.totalIncrements).toBe(3)
  })
})