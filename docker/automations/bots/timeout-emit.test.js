const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')
const timeoutEmit = require('./timeout-emit')

describe('timeout-emit bot', () => {
  let mockMqtt
  let bot
  let persistedCache

  beforeEach(() => {
    jest.useFakeTimers()

    // Initialize with the default state from the bot
    const botInstance = timeoutEmit('test-timeout', {
      listenTopic: '/test/listen',
      emitTopic: '/test/emit',
      emitValue: 'test-value',
      timeout: 60000 // 1 minute
    })

    persistedCache = {
      timerStartTime: null,
      lastPayload: null,
      timerActive: false
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
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('basic functionality', () => {
    beforeEach(() => {
      bot = timeoutEmit('test-timeout', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: 'test-value',
        timeout: 60000
      })
    })

    it('should initialize with default persistent cache state', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(persistedCache.timerStartTime).toBeNull()
      expect(persistedCache.lastPayload).toBeNull()
      expect(persistedCache.timerActive).toBe(false)
    })

    it('should subscribe to listen topic', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledWith('/test/listen', expect.any(Function))
    })

    it('should start timer and update cache when receiving matching message', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      const testPayload = { test: 'data' }
      await mockMqtt._triggerMessage('/test/listen', testPayload)

      expect(persistedCache.timerActive).toBe(true)
      expect(persistedCache.timerStartTime).toBe(Date.now())
      expect(persistedCache.lastPayload).toEqual(testPayload)
    })

    it('should emit value after timeout expires', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', { test: 'data' })

      // Advance time by timeout duration
      jest.advanceTimersByTime(60000)

      expect(mockMqtt.publish).toHaveBeenCalledWith('/test/emit', 'test-value')
      expect(persistedCache.timerActive).toBe(false)
      expect(persistedCache.timerStartTime).toBeNull()
      expect(persistedCache.lastPayload).toBeNull()
    })

    it('should not start multiple timers', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', { first: 'data' })
      const firstStartTime = persistedCache.timerStartTime

      // Try to start another timer
      await mockMqtt._triggerMessage('/test/listen', { second: 'data' })

      expect(persistedCache.timerStartTime).toBe(firstStartTime)
      expect(persistedCache.lastPayload).toEqual({ first: 'data' })
    })

    it('should stop timer when receiving non-matching message', async () => {
      bot = timeoutEmit('test-timeout', {
        listenTopic: '/test/listen',
        listenFilter: (payload) => payload.shouldStart === true,
        emitTopic: '/test/emit',
        emitValue: 'test-value',
        timeout: 60000
      })

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Start timer
      await mockMqtt._triggerMessage('/test/listen', { shouldStart: true })
      expect(persistedCache.timerActive).toBe(true)

      // Stop timer
      await mockMqtt._triggerMessage('/test/listen', { shouldStart: false })
      expect(persistedCache.timerActive).toBe(false)
      expect(persistedCache.timerStartTime).toBeNull()
      expect(persistedCache.lastPayload).toBeNull()
    })
  })

  describe('function-based emit values', () => {
    beforeEach(() => {
      bot = timeoutEmit('test-timeout', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: (payload) => ({ processed: payload.value * 2 }),
        timeout: 30000
      })
    })

    it('should call emitValue function with original payload', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      const testPayload = { value: 10 }
      await mockMqtt._triggerMessage('/test/listen', testPayload)

      jest.advanceTimersByTime(30000)

      expect(mockMqtt.publish).toHaveBeenCalledWith('/test/emit', { processed: 20 })
    })

    it('should use last payload for function when timer expires', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', { value: 5 })

      jest.advanceTimersByTime(30000)

      expect(mockMqtt.publish).toHaveBeenCalledWith('/test/emit', { processed: 10 })
    })
  })

  describe('custom listenFilter', () => {
    beforeEach(() => {
      bot = timeoutEmit('test-timeout', {
        listenTopic: '/test/listen',
        listenFilter: (payload) => payload.priority > 5,
        emitTopic: '/test/emit',
        emitValue: 'high-priority-alert',
        timeout: 45000
      })
    })

    it('should start timer only for matching messages', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Should not start timer
      await mockMqtt._triggerMessage('/test/listen', { priority: 3 })
      expect(persistedCache.timerActive).toBe(false)

      // Should start timer
      await mockMqtt._triggerMessage('/test/listen', { priority: 8 })
      expect(persistedCache.timerActive).toBe(true)
    })

    it('should stop timer for non-matching messages', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Start timer
      await mockMqtt._triggerMessage('/test/listen', { priority: 10 })
      expect(persistedCache.timerActive).toBe(true)

      // Stop timer
      await mockMqtt._triggerMessage('/test/listen', { priority: 2 })
      expect(persistedCache.timerActive).toBe(false)
    })
  })

  describe('persistence and recovery', () => {
    beforeEach(() => {
      bot = timeoutEmit('test-timeout', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: 'recovered-value',
        timeout: 120000 // 2 minutes
      })
    })

    it('should restore timer with remaining time after restart', async () => {
      const startTime = Date.now()
      persistedCache.timerActive = true
      persistedCache.timerStartTime = startTime
      persistedCache.lastPayload = { original: 'data' }

      // Simulate 30 seconds have passed
      jest.setSystemTime(startTime + 30000)

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Should restore timer with remaining 90 seconds
      jest.advanceTimersByTime(90000)

      expect(mockMqtt.publish).toHaveBeenCalledWith('/test/emit', 'recovered-value')
    })

    it('should emit immediately if timer expired during downtime', async () => {
      const startTime = Date.now()
      persistedCache.timerActive = true
      persistedCache.timerStartTime = startTime
      persistedCache.lastPayload = { expired: 'data' }

      // Simulate 3 minutes have passed (longer than 2 minute timeout)
      jest.setSystemTime(startTime + 180000)

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.publish).toHaveBeenCalledWith('/test/emit', 'recovered-value')
      expect(persistedCache.timerActive).toBe(false)
    })

    it('should handle recovery with function-based emitValue', async () => {
      bot = timeoutEmit('test-timeout', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: (payload) => ({ recovered: payload.value }),
        timeout: 60000
      })

      const startTime = Date.now()
      persistedCache.timerActive = true
      persistedCache.timerStartTime = startTime
      persistedCache.lastPayload = { value: 'test-data' }

      // Simulate restart after timeout expired
      jest.setSystemTime(startTime + 120000)

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.publish).toHaveBeenCalledWith('/test/emit', { recovered: 'test-data' })
    })

    it('should not restore timer if not active in cache', async () => {
      persistedCache.timerActive = false
      persistedCache.timerStartTime = Date.now()
      persistedCache.lastPayload = { test: 'data' }

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should not restore timer if no start time in cache', async () => {
      persistedCache.timerActive = true
      persistedCache.timerStartTime = null
      persistedCache.lastPayload = { test: 'data' }

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('verbose logging', () => {
    let consoleSpy

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation()
      bot = timeoutEmit('verbose-test', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: 'test-value',
        timeout: 60000,
        verbose: true
      })
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('should log when starting timer', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', { test: 'data' })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[verbose-test] received',
        { test: 'data' },
        'starting timer for 1 minutes'
      )
    })

    it('should log when timer already started', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', { first: 'data' })
      await mockMqtt._triggerMessage('/test/listen', { second: 'data' })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[verbose-test] received',
        { second: 'data' },
        'timer already started'
      )
    })

    it('should log when restoring timer', async () => {
      const startTime = Date.now()
      persistedCache.timerActive = true
      persistedCache.timerStartTime = startTime
      persistedCache.lastPayload = { test: 'data' }

      jest.setSystemTime(startTime + 30000)

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[verbose-test] restoring timer with 0.5 minutes remaining'
      )
    })

    it('should log when timer expired during downtime', async () => {
      const startTime = Date.now()
      persistedCache.timerActive = true
      persistedCache.timerStartTime = startTime
      persistedCache.lastPayload = { test: 'data' }

      jest.setSystemTime(startTime + 120000)

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[verbose-test] timer expired during downtime, emitting immediately'
      )
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      bot = timeoutEmit('edge-test', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: 'edge-value',
        timeout: 60000
      })
    })

    it('should handle null payload gracefully', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', null)

      expect(persistedCache.timerActive).toBe(true)
      expect(persistedCache.lastPayload).toBeNull()
    })

    it('should handle undefined payload gracefully', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/test/listen', undefined)

      expect(persistedCache.timerActive).toBe(true)
      expect(persistedCache.lastPayload).toBeUndefined()
    })

    it('should handle listenFilter throwing exception', async () => {
      bot = timeoutEmit('error-test', {
        listenTopic: '/test/listen',
        listenFilter: () => { throw new Error('Filter error') },
        emitTopic: '/test/emit',
        emitValue: 'error-value',
        timeout: 60000
      })

      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(() => mockMqtt._triggerMessage('/test/listen', { test: 'data' })).toThrow('Filter error')
    })

    it('should handle emitValue function throwing exception', async () => {
      bot = timeoutEmit('emit-error-test', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: () => { throw new Error('Emit error') },
        timeout: 60000
      })

      await bot.start({ mqtt: mockMqtt, persistedCache })
      await mockMqtt._triggerMessage('/test/listen', { test: 'data' })

      expect(() => jest.advanceTimersByTime(60000)).toThrow('Emit error')
    })
  })

  describe('cache migration', () => {
    it('should have proper cache structure', () => {
      const bot = timeoutEmit('test', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: 'test',
        timeout: 1000
      })

      expect(bot.persistedCache).toEqual({
        version: 1,
        default: {
          timerStartTime: null,
          lastPayload: null,
          timerActive: false
        },
        migrate: expect.any(Function)
      })
    })

    it('should return state unchanged in migrate function', () => {
      const bot = timeoutEmit('test', {
        listenTopic: '/test/listen',
        emitTopic: '/test/emit',
        emitValue: 'test',
        timeout: 1000
      })

      const testState = { timerActive: true, timerStartTime: 123, lastPayload: {} }
      const result = bot.persistedCache.migrate({
        version: 1,
        defaultState: bot.persistedCache.default,
        state: testState
      })

      expect(result).toBe(testState)
    })
  })

  describe('legacy compatibility tests', () => {
    test('should emit after timeout after receiving message', async () => {
      const timeoutEmitBot = timeoutEmit('test-timeout-emit', {
        listenTopic: 'test-topic',
        timeout: 1000,
        emitTopic: 'emit-topic',
        emitValue: 'timeout'
      })

      const persistedCache = {
        timerStartTime: null,
        lastPayload: null,
        timerActive: false
      }

      const subscribe = jest.fn().mockImplementation((topic, callback) => {
        subscribe._callback = callback
        return Promise.resolve()
      })
      const publish = jest.fn()
      const mqtt = {subscribe, publish}

      // start the bot
      await timeoutEmitBot.start({ mqtt, persistedCache })
      expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

      // check for timeout after start
      jest.advanceTimersByTime(1000)
      expect(publish).not.toHaveBeenCalled()

      // receive a message
      subscribe._callback('payload')
      expect(publish).not.toHaveBeenCalled()

      // check for timeout after message
      jest.advanceTimersByTime(1000)
      expect(publish).toHaveBeenCalledWith('emit-topic', 'timeout')

      // check for timeout after emit
      publish.mockClear()
      jest.advanceTimersByTime(1000)
      expect(publish).not.toHaveBeenCalled()
    })

    test('should emit after timeout after first received message within timeout', async () => {
      const timeoutEmitBot = timeoutEmit('test-timeout-emit', {
        listenTopic: 'test-topic',
        timeout: 1000,
        emitTopic: 'emit-topic',
        emitValue: 'timeout'
      })

      const persistedCache = {
        timerStartTime: null,
        lastPayload: null,
        timerActive: false
      }

      const subscribe = jest.fn().mockImplementation((topic, callback) => {
        subscribe._callback = callback
        return Promise.resolve()
      })
      const publish = jest.fn()
      const mqtt = {subscribe, publish}

      // start the bot
      await timeoutEmitBot.start({ mqtt, persistedCache })
      expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

      // receive a message
      subscribe._callback('payload')
      expect(publish).not.toHaveBeenCalled()

      // advance with half of the timeout
      jest.advanceTimersByTime(500)
      expect(publish).not.toHaveBeenCalled()

      // receive a message
      subscribe._callback('payload')
      expect(publish).not.toHaveBeenCalled()

      // advance with half of the timeout
      jest.advanceTimersByTime(500)
      expect(publish).toHaveBeenCalledWith('emit-topic', 'timeout')

      // check for timeout after emit
      publish.mockClear()
      jest.advanceTimersByTime(1000)
      expect(publish).not.toHaveBeenCalled()
    })

    test('should emit after timeout after receiving message with filter', async () => {
      const timeoutEmitBot = timeoutEmit('test-timeout-emit', {
        listenTopic: 'test-topic',
        listenFilter: (payload) => payload === 'valid',
        timeout: 1000,
        emitTopic: 'emit-topic',
        emitValue: 'timeout'
      })

      const persistedCache = {
        timerStartTime: null,
        lastPayload: null,
        timerActive: false
      }

      const subscribe = jest.fn().mockImplementation((topic, callback) => {
        subscribe._callback = callback
        return Promise.resolve()
      })
      const publish = jest.fn()
      const mqtt = {subscribe, publish}

      // start the bot
      await timeoutEmitBot.start({ mqtt, persistedCache })
      expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

      // receive an invalid message
      subscribe._callback('invalid')
      expect(publish).not.toHaveBeenCalled()

      // check for timeout after invalid message
      jest.advanceTimersByTime(1000)
      expect(publish).not.toHaveBeenCalled()

      // receive a valid message
      subscribe._callback('valid')
      expect(publish).not.toHaveBeenCalled()

      // check for timeout after message
      jest.advanceTimersByTime(1000)
      expect(publish).toHaveBeenCalledWith('emit-topic', 'timeout')

      // check for timeout after emit
      publish.mockClear()
      jest.advanceTimersByTime(1000)
      expect(publish).not.toHaveBeenCalled()
    })

    test('should not emit after receiving message with filter false', async () => {
      const timeoutEmitBot = timeoutEmit('test-timeout-emit', {
        listenTopic: 'test-topic',
        listenFilter: (payload) => payload === 'valid',
        timeout: 1000,
        emitTopic: 'emit-topic',
        emitValue: 'timeout'
      })

      const persistedCache = {
        timerStartTime: null,
        lastPayload: null,
        timerActive: false
      }

      const subscribe = jest.fn().mockImplementation((topic, callback) => {
        subscribe._callback = callback
        return Promise.resolve()
      })
      const publish = jest.fn()
      const mqtt = {subscribe, publish}

      // start the bot
      await timeoutEmitBot.start({ mqtt, persistedCache })
      expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

      // receive a valid message first
      subscribe._callback('valid')
      expect(publish).not.toHaveBeenCalled()

      // check for timeout after valid message
      jest.advanceTimersByTime(500)
      expect(publish).not.toHaveBeenCalled()

      // receive an invalid message (should stop timer)
      subscribe._callback('invalid')
      expect(publish).not.toHaveBeenCalled()

      // check for timeout after invalid message
      jest.advanceTimersByTime(1000)
      expect(publish).not.toHaveBeenCalled()
    })
  })
})
