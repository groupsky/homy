const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const powerCycleOnLowPower = require('./power-cycle-on-low-power')

describe('power-cycle-on-low-power bot', () => {
  let bot
  let mockMqtt
  let persistedCache

  const defaultConfig = {
    powerMonitor: {
      statusTopic: '/modbus/tetriary/heat_pump/reading',
      powerField: 'b_ap',
      threshold: 30,
      durationMs: 180000 // 3 minutes
    },
    controlDevice: {
      commandTopic: 'z2m/house1/circulation-heatpump/set'
    },
    powerCycle: {
      offDurationMs: 5000 // 5 seconds
    },
    verbose: false
  }

  beforeEach(() => {
    jest.useFakeTimers()
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

    bot = powerCycleOnLowPower('testPowerCycle', defaultConfig)
    persistedCache = {
      lowPowerStartTime: null,
      cyclingInProgress: false,
      lastPowerValue: null,
      cycleOffTime: null
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  describe('configuration validation', () => {
    it('should throw error if powerMonitor.statusTopic is missing', () => {
      expect(() => {
        powerCycleOnLowPower('test', {
          ...defaultConfig,
          powerMonitor: { powerField: 'b_ap', threshold: 30, durationMs: 180000 }
        })
      }).toThrow('powerMonitor.statusTopic is required')
    })

    it('should throw error if powerMonitor.powerField is missing', () => {
      expect(() => {
        powerCycleOnLowPower('test', {
          ...defaultConfig,
          powerMonitor: { statusTopic: '/modbus/tetriary/heat_pump/reading', threshold: 30, durationMs: 180000 }
        })
      }).toThrow('powerMonitor.powerField is required')
    })

    it('should throw error if powerMonitor.threshold is missing', () => {
      expect(() => {
        powerCycleOnLowPower('test', {
          ...defaultConfig,
          powerMonitor: { statusTopic: '/modbus/tetriary/heat_pump/reading', powerField: 'b_ap', durationMs: 180000 }
        })
      }).toThrow('powerMonitor.threshold must be a positive number')
    })

    it('should throw error if powerMonitor.threshold is negative', () => {
      expect(() => {
        powerCycleOnLowPower('test', {
          ...defaultConfig,
          powerMonitor: { statusTopic: '/modbus/tetriary/heat_pump/reading', powerField: 'b_ap', threshold: -10, durationMs: 180000 }
        })
      }).toThrow('powerMonitor.threshold must be a positive number')
    })

    it('should throw error if powerMonitor.durationMs is missing', () => {
      expect(() => {
        powerCycleOnLowPower('test', {
          ...defaultConfig,
          powerMonitor: { statusTopic: '/modbus/tetriary/heat_pump/reading', powerField: 'b_ap', threshold: 30, minPowerThreshold: 5 }
        })
      }).toThrow('powerMonitor.durationMs must be a positive number')
    })

    it('should throw error if controlDevice.commandTopic is missing', () => {
      expect(() => {
        powerCycleOnLowPower('test', { ...defaultConfig, controlDevice: {} })
      }).toThrow('controlDevice.commandTopic is required')
    })

    it('should throw error if powerCycle.offDurationMs is missing', () => {
      expect(() => {
        powerCycleOnLowPower('test', { ...defaultConfig, powerCycle: {} })
      }).toThrow('powerCycle.offDurationMs must be a positive number')
    })

    it('should throw error if powerCycle.offDurationMs is less than 5000ms', () => {
      expect(() => {
        powerCycleOnLowPower('test', {
          ...defaultConfig,
          powerCycle: { offDurationMs: 3000 }
        })
      }).toThrow('powerCycle.offDurationMs must be at least 5000ms')
    })

  })

  describe('initialization', () => {
    it('should subscribe to power monitor topic', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledWith(
        '/modbus/tetriary/heat_pump/reading',
        expect.any(Function)
      )
    })

    it('should initialize persistent cache structure', () => {
      expect(bot.persistedCache.default).toEqual({
        lowPowerStartTime: null,
        cyclingInProgress: false,
        lastPowerValue: null,
        cycleOffTime: null
      })
    })
  })

  describe('payload validation', () => {
    it('should handle null payload gracefully', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/main/heat_pump/+', null)
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle undefined payload gracefully', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/main/heat_pump/+', undefined)
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle missing power field', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/main/heat_pump/+', { a_ap: 100 })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle non-numeric power value', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 'high' })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })
  })


  describe('low power detection', () => {
    it('should not trigger power cycle immediately when power drops below threshold', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should trigger power cycle after 3 minutes of continuous low power', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Power drops below threshold
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000) // 3 minutes

      // Wait for async OFF command
      await Promise.resolve()

      // Should send OFF command
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'OFF' }
      )

      // Advance time by off duration
      jest.advanceTimersByTime(5000) // 5 seconds

      // Wait for async ON command
      await Promise.resolve()

      // Should send ON command
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'ON' }
      )

      expect(mockMqtt.publish).toHaveBeenCalledTimes(2)
    })

    it('should update low power start time when power drops', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      const beforeTime = Date.now()
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 25 })

      expect(persistedCache.lowPowerStartTime).toBeGreaterThanOrEqual(beforeTime)
      expect(persistedCache.lowPowerStartTime).toBeLessThanOrEqual(Date.now())
    })

    it('should persist last power value', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 25 })

      expect(persistedCache.lastPowerValue).toBe(25)
    })
  })

  describe('power recovery handling', () => {
    it('should cancel power cycle if power returns to normal before duration', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Power drops
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(120000) // 2 minutes

      // Power recovers
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 50 })
      jest.advanceTimersByTime(60000) // 1 more minute (total 3)

      // Should not trigger power cycle
      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should clear low power start time when power returns to normal', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      expect(persistedCache.lowPowerStartTime).not.toBeNull()

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 50 })
      expect(persistedCache.lowPowerStartTime).toBeNull()
    })
  })

  describe('rapid power fluctuation handling', () => {
    it('should reset timer if power fluctuates above and below threshold', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Power drops
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(160000) // 2.67 minutes

      // Power recovers briefly
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 50 })

      // Power drops again
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 15 })
      jest.advanceTimersByTime(20000) // 0.33 minutes (total time would be 3 if not reset)

      // Should not trigger yet (timer was reset)
      expect(mockMqtt.publish).not.toHaveBeenCalled()

      // Advance to 3 minutes from last drop
      jest.advanceTimersByTime(160000) // Total 3 minutes from last drop

      // Now it should trigger
      expect(mockMqtt.publish).toHaveBeenCalled()
    })

    it('should not reset timer if power stays below threshold', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Power drops
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(120000) // 2 minutes

      // Power fluctuates but stays below threshold
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 25 })
      jest.advanceTimersByTime(60000) // 1 more minute (total 3)

      // Should trigger
      expect(mockMqtt.publish).toHaveBeenCalled()
    })
  })

  describe('repeated cycling prevention', () => {
    it('should not trigger power cycle again while cycling is in progress', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // First low power event
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000) // 15 minutes

      // Power cycle starts
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)

      // More low power messages during cycling
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 15 })
      jest.advanceTimersByTime(180000) // Another 15 minutes

      // Should not trigger another cycle
      jest.advanceTimersByTime(5000) // Complete the first cycle
      expect(mockMqtt.publish).toHaveBeenCalledTimes(2) // Only OFF and ON from first cycle
    })

    it('should allow new power cycle after previous cycle completes and power returns normal', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // First cycle
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000) // 15 minutes
      await Promise.resolve() // Wait for OFF
      jest.advanceTimersByTime(5000) // Complete cycle
      await Promise.resolve() // Wait for ON

      expect(mockMqtt.publish).toHaveBeenCalledTimes(2)
      mockMqtt.publish.mockClear()

      // Power returns to normal
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 100 })

      // Power drops again
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 15 })
      jest.advanceTimersByTime(180000) // 15 minutes
      await Promise.resolve() // Wait for OFF

      // Should trigger new cycle
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      jest.advanceTimersByTime(5000)
      await Promise.resolve() // Wait for ON
      expect(mockMqtt.publish).toHaveBeenCalledTimes(2)
    })

    it('should set cycling flag during power cycle', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      expect(persistedCache.cyclingInProgress).toBe(false)

      jest.advanceTimersByTime(180000) // Trigger cycle

      // Wait for async operations
      await Promise.resolve()

      expect(persistedCache.cyclingInProgress).toBe(true)

      jest.advanceTimersByTime(5000) // Complete cycle

      // Wait for async ON command with retry
      await Promise.resolve()
      await Promise.resolve()

      expect(persistedCache.cyclingInProgress).toBe(false)
    })
  })

  describe('MQTT publish error handling', () => {
    it('should handle OFF command failure gracefully', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      mockMqtt.publish = jest.fn().mockRejectedValue(new Error('Device offline'))

      bot = powerCycleOnLowPower('testPowerCycle', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000)

      // Wait for promise rejection
      await Promise.resolve()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testPowerCycle]'),
        expect.stringContaining('failed to send OFF command'),
        expect.stringContaining('Device offline')
      )

      consoleSpy.mockRestore()
    })

    it('should handle ON command failure gracefully with retries', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      let callCount = 0
      mockMqtt.publish = jest.fn().mockImplementation(() => {
        callCount++
        if (callCount >= 2) {
          // All ON attempts fail
          return Promise.reject(new Error('Device offline'))
        }
        return Promise.resolve()
      })

      bot = powerCycleOnLowPower('testPowerCycle', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000)
      await Promise.resolve() // Wait for OFF
      jest.advanceTimersByTime(5000)
      await Promise.resolve() // Wait for first ON attempt to fail

      // Advance through all retries
      jest.advanceTimersByTime(1000) // First backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 2
      jest.advanceTimersByTime(2000) // Second backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 3
      jest.advanceTimersByTime(4000) // Third backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 4
      jest.advanceTimersByTime(8000) // Fourth backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 5
      await Promise.resolve() // Wait for final log message

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testPowerCycle]'),
        expect.stringContaining('failed to send ON command'),
        expect.stringContaining('Device offline')
      )

      consoleSpy.mockRestore()
    })

    it('should reset cycling flag even if commands fail', async () => {
      mockMqtt.publish = jest.fn().mockRejectedValue(new Error('Device offline'))

      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000)
      jest.advanceTimersByTime(5000)

      // Wait for all promises
      await Promise.resolve()
      await Promise.resolve()

      expect(persistedCache.cyclingInProgress).toBe(false)
    })

    it('should retry ON command if MQTT publish fails during power cycle', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      mockMqtt.publish
        .mockResolvedValueOnce() // OFF succeeds
        .mockRejectedValueOnce(new Error('Connection refused')) // ON attempt 1 fails
        .mockRejectedValueOnce(new Error('Connection refused')) // ON attempt 2 fails
        .mockResolvedValueOnce() // ON attempt 3 succeeds

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000) // Trigger low power timer
      await Promise.resolve() // OFF command

      // The OFF duration timer triggers the ON command with retries
      jest.advanceTimersByTime(5000) // OFF duration
      await Promise.resolve() // Start retry loop

      // Advance through retry backoffs
      jest.advanceTimersByTime(1000) // First backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for second attempt
      jest.advanceTimersByTime(2000) // Second backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for third attempt to execute
      await Promise.resolve() // Wait for cleanup

      expect(mockMqtt.publish).toHaveBeenCalledTimes(4) // 1 OFF + 3 ON attempts
      expect(persistedCache.cyclingInProgress).toBe(false)
    })

    it('should log warning when all ON retries fail during power cycle', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      mockMqtt.publish = jest.fn()
        .mockResolvedValueOnce() // OFF succeeds
        .mockRejectedValue(new Error('Connection refused')) // All ON attempts fail

      bot = powerCycleOnLowPower('testPowerCycle', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000) // Trigger low power timer
      await Promise.resolve() // OFF command

      // Trigger OFF duration
      jest.advanceTimersByTime(5000) // OFF duration
      await Promise.resolve() // Start retry loop

      // Advance through all retries
      jest.advanceTimersByTime(1000) // First backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 2
      jest.advanceTimersByTime(2000) // Second backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 3
      jest.advanceTimersByTime(4000) // Third backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 4
      jest.advanceTimersByTime(8000) // Fourth backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for attempt 5
      await Promise.resolve() // Wait for final log message

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testPowerCycle]'),
        expect.stringContaining('Failed to send ON after all retries')
      )

      consoleSpy.mockRestore()
    })

    it('should retry ON command if MQTT publish fails during restoration (remaining time)', async () => {
      const cycleOffTime = Date.now() - 2000
      persistedCache.cyclingInProgress = true
      persistedCache.cycleOffTime = cycleOffTime
      persistedCache.lastPowerValue = 20

      mockMqtt.publish
        .mockRejectedValueOnce(new Error('Connection refused')) // ON attempt 1 fails
        .mockResolvedValueOnce() // ON attempt 2 succeeds

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Trigger remaining time
      jest.advanceTimersByTime(3000) // Remaining time (5s - 2s elapsed)
      await Promise.resolve() // Start retry loop

      // First retry backoff
      jest.advanceTimersByTime(1000)
      await Promise.resolve()
      await Promise.resolve() // Wait for second attempt to execute
      await Promise.resolve() // Wait for cleanup

      expect(mockMqtt.publish).toHaveBeenCalledTimes(2) // 2 ON attempts
      expect(persistedCache.cyclingInProgress).toBe(false)
    })

    it('should retry ON command if MQTT publish fails during restoration (immediate)', async () => {
      const cycleOffTime = Date.now() - 10000
      persistedCache.cyclingInProgress = true
      persistedCache.cycleOffTime = cycleOffTime
      persistedCache.lastPowerValue = 20

      mockMqtt.publish
        .mockRejectedValueOnce(new Error('Connection refused')) // ON attempt 1 fails
        .mockRejectedValueOnce(new Error('Connection refused')) // ON attempt 2 fails
        .mockResolvedValueOnce() // ON attempt 3 succeeds

      // Start bot - this triggers immediate retry logic in an async block
      const startPromise = bot.start({ mqtt: mockMqtt, persistedCache })

      // Wait for the start method to complete (subscription setup)
      await startPromise

      // Trigger the setTimeout(0) for immediate restoration
      jest.advanceTimersByTime(0)
      await Promise.resolve()

      // Advance through retries
      jest.advanceTimersByTime(1000) // First backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for second attempt
      jest.advanceTimersByTime(2000) // Second backoff
      await Promise.resolve()
      await Promise.resolve() // Wait for third attempt to execute
      await Promise.resolve() // Wait for cleanup

      expect(mockMqtt.publish).toHaveBeenCalledTimes(3) // 3 ON attempts
      expect(persistedCache.cyclingInProgress).toBe(false)
    })
  })

  describe('state persistence and restoration', () => {
    it('should restore power cycle timer after service restart with low power condition', async () => {
      // Simulate low power started 2 minutes ago
      const lowPowerStartTime = Date.now() - 120000
      persistedCache.lowPowerStartTime = lowPowerStartTime
      persistedCache.cyclingInProgress = false
      persistedCache.lastPowerValue = 20

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Should trigger in 1 minute (3 - 2 elapsed)
      jest.advanceTimersByTime(60000)

      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'OFF' }
      )
    })

    it('should trigger power cycle immediately if duration already elapsed during restart', async () => {
      // Simulate low power started 5 minutes ago (beyond 3 minute threshold)
      const lowPowerStartTime = Date.now() - 300000
      persistedCache.lowPowerStartTime = lowPowerStartTime
      persistedCache.cyclingInProgress = false
      persistedCache.lastPowerValue = 15

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Wait for promises
      await Promise.resolve()

      // Should trigger immediately
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'OFF' }
      )
    })

    it('should restore ON timer after restart when cycling was in progress', async () => {
      // Simulate OFF command was sent 2 seconds ago
      const cycleOffTime = Date.now() - 2000
      persistedCache.cyclingInProgress = true
      persistedCache.cycleOffTime = cycleOffTime
      persistedCache.lastPowerValue = 20

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Should send ON after remaining 3 seconds (5 - 2 elapsed)
      jest.advanceTimersByTime(3000)
      await Promise.resolve()
      await Promise.resolve() // Wait for retry function to complete

      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'ON' }
      )

      // Should clear cycling state
      expect(persistedCache.cyclingInProgress).toBe(false)
      expect(persistedCache.cycleOffTime).toBeNull()
    })

    it('should send ON immediately if OFF timer already elapsed during restart', async () => {
      // Simulate OFF command was sent 10 seconds ago (more than 5 second duration)
      const cycleOffTime = Date.now() - 10000
      persistedCache.cyclingInProgress = true
      persistedCache.cycleOffTime = cycleOffTime
      persistedCache.lastPowerValue = 20

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Trigger immediate setTimeout(0)
      jest.advanceTimersByTime(0)
      await Promise.resolve()
      await Promise.resolve() // Wait for retry function to complete

      // Should send ON immediately
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'ON' }
      )

      expect(persistedCache.cyclingInProgress).toBe(false)
      expect(persistedCache.cycleOffTime).toBeNull()
    })

    it('should not restore timer if cycling was in progress but cycleOffTime is missing', async () => {
      persistedCache.cyclingInProgress = true
      persistedCache.cycleOffTime = null
      persistedCache.lastPowerValue = 20

      await bot.start({ mqtt: mockMqtt, persistedCache })

      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should not restore low power timer if cycling was in progress', async () => {
      const lowPowerStartTime = Date.now() - 120000
      const cycleOffTime = Date.now() - 2000
      persistedCache.lowPowerStartTime = lowPowerStartTime
      persistedCache.cyclingInProgress = true
      persistedCache.cycleOffTime = cycleOffTime
      persistedCache.lastPowerValue = 20

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Should only restore ON timer, not low power timer
      jest.advanceTimersByTime(3000)
      await Promise.resolve()

      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'ON' }
      )
    })

    it('should not restore timer if no low power condition persisted', async () => {
      persistedCache.lowPowerStartTime = null
      persistedCache.cyclingInProgress = false
      persistedCache.lastPowerValue = null

      await bot.start({ mqtt: mockMqtt, persistedCache })

      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('custom configuration', () => {
    it('should support custom threshold', async () => {
      const customConfig = {
        ...defaultConfig,
        powerMonitor: {
          ...defaultConfig.powerMonitor,
          threshold: 50
        }
      }

      bot = powerCycleOnLowPower('testPowerCycle', customConfig)
      persistedCache = { lowPowerStartTime: null, cyclingInProgress: false, lastPowerValue: null, cycleOffTime: null }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // 40W should be below 50W threshold
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 40 })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).toHaveBeenCalled()
    })

    it('should support custom duration', async () => {
      const customConfig = {
        ...defaultConfig,
        powerMonitor: {
          ...defaultConfig.powerMonitor,
          durationMs: 300000 // 5 minutes
        }
      }

      bot = powerCycleOnLowPower('testPowerCycle', customConfig)
      persistedCache = { lowPowerStartTime: null, cyclingInProgress: false, lastPowerValue: null, cycleOffTime: null }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(300000) // 5 minutes

      expect(mockMqtt.publish).toHaveBeenCalled()
    })

    it('should support custom off duration', async () => {
      const customConfig = {
        ...defaultConfig,
        powerCycle: {
          offDurationMs: 10000 // 10 seconds
        }
      }

      bot = powerCycleOnLowPower('testPowerCycle', customConfig)
      persistedCache = { lowPowerStartTime: null, cyclingInProgress: false, lastPowerValue: null, cycleOffTime: null }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })
      jest.advanceTimersByTime(180000)
      await Promise.resolve() // Wait for OFF
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1) // OFF
      jest.advanceTimersByTime(10000) // 10 seconds
      await Promise.resolve() // Wait for ON
      expect(mockMqtt.publish).toHaveBeenCalledTimes(2) // ON
    })
  })

  describe('verbose logging', () => {
    it('should log events when verbose is enabled', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      bot = powerCycleOnLowPower('testPowerCycle', verboseConfig)
      persistedCache = { lowPowerStartTime: null, cyclingInProgress: false, lastPowerValue: null, cycleOffTime: null }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testPowerCycle]'),
        expect.stringContaining('power below threshold')
      )

      consoleSpy.mockRestore()
    })

    it('should not log when verbose is disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      await bot.start({ mqtt: mockMqtt, persistedCache })
      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 20 })

      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('should handle power exactly at threshold (not below)', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 30 })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should trigger power cycle when power is zero (device turned off)', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 0 })
      jest.advanceTimersByTime(180000)

      await Promise.resolve()

      // Should trigger power cycle even at 0W
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'OFF' }
      )
    })

    it('should handle very high power values', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: 10000 })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should trigger power cycle for negative power values (below threshold)', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('/modbus/tetriary/heat_pump/reading', { b_ap: -10 })
      jest.advanceTimersByTime(180000)

      await Promise.resolve()

      // Negative power is below threshold, should trigger
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/circulation-heatpump/set',
        { state: 'OFF' }
      )
    })
  })
})
