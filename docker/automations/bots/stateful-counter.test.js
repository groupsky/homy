const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')
const createStatefulCounter = require('./stateful-counter')

describe('stateful-counter bot', () => {
  let mockMqtt
  let bot
  let persistedCache

  beforeEach(() => {
    // Initialize with the default state from the bot
    const botInstance = createStatefulCounter('test-counter', {})
    persistedCache = {
      count: 0,
      lastReset: new Date().toISOString(),
      totalIncrements: 0,
      history: []
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
    await bot.start({ mqtt: mockMqtt, persistedCache })

    // Should initialize with the expected default state
    expect(persistedCache.count).toBe(0)
    expect(persistedCache.totalIncrements).toBe(0)
    expect(persistedCache.history).toEqual([])
  })

  it('should subscribe to increment topic', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/increment', expect.any(Function))
  })

  it('should increment count when receiving increment message', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    await mockMqtt._triggerMessage('/test/increment', { increment: 1 })

    expect(persistedCache.count).toBe(1)
    expect(persistedCache.totalIncrements).toBe(1)
  })

  it('should use default increment of 1 when not specified', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    await mockMqtt._triggerMessage('/test/increment', {})

    expect(persistedCache.count).toBe(1)
    expect(persistedCache.totalIncrements).toBe(1)
  })

  it('should use custom increment value', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    await mockMqtt._triggerMessage('/test/increment', { increment: 5 })

    expect(persistedCache.count).toBe(5)
    expect(persistedCache.totalIncrements).toBe(1)
  })

  it('should publish output when outputTopic is configured', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    await mockMqtt._triggerMessage('/test/increment', { increment: 3 })

    expect(mockMqtt.publish).toHaveBeenCalledWith('/test/output', {
      count: 3,
      totalIncrements: 1,
      history: expect.arrayContaining([
        expect.objectContaining({
          increment: 3,
          newCount: 3,
          timestamp: expect.any(String)
        })
      ]),
      botName: 'test-counter'
    })
  })

  it('should reset count when receiving reset message', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    // Set up the state first
    persistedCache.count = 10
    persistedCache.totalIncrements = 5
    persistedCache.lastReset = '2023-01-01T00:00:00.000Z'

    await mockMqtt._triggerMessage('/test/reset', {})

    expect(persistedCache.count).toBe(0)
    expect(persistedCache.totalIncrements).toBe(5)
    expect(persistedCache.lastReset).not.toBe('2023-01-01T00:00:00.000Z')
  })

  it('should preserve totalIncrements across resets', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    await mockMqtt._triggerMessage('/test/increment', {})
    await mockMqtt._triggerMessage('/test/increment', {})
    await mockMqtt._triggerMessage('/test/reset', {})

    expect(persistedCache.count).toBe(0)
    expect(persistedCache.totalIncrements).toBe(2)
  })

  it('should publish reset confirmation', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

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
    await bot.start({ mqtt: mockMqtt, persistedCache })

    // Set up the state first
    persistedCache.count = 42
    persistedCache.totalIncrements = 100
    persistedCache.lastReset = '2023-01-01T00:00:00.000Z'

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

    await expect(minimalBot.start({ mqtt: mockMqtt, persistedCache })).resolves.not.toThrow()

    expect(mockMqtt.subscribe).toHaveBeenCalledTimes(1)
    expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/increment', expect.any(Function))
  })

  it('should accumulate count across multiple increments', async () => {
    await bot.start({ mqtt: mockMqtt, persistedCache })

    await mockMqtt._triggerMessage('/test/increment', { increment: 5 })
    await mockMqtt._triggerMessage('/test/increment', { increment: 3 })
    await mockMqtt._triggerMessage('/test/increment', { increment: 2 })

    expect(persistedCache.count).toBe(10)
    expect(persistedCache.totalIncrements).toBe(3)
  })
})