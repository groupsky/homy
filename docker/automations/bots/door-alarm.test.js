const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const doorAlarm = require('./door-alarm')

describe('door-alarm bot', () => {
  let bot
  let mockMqtt
  let persistedCache

  const defaultConfig = {
    doorSensor: {
      statusTopic: 'homy/features/open/front_main_door_open/status'
    },
    alarmDevice: {
      commandTopic: 'z2m/house1/floor1-alarm/set'
    },
    escalationSteps: [
      { delayMs: 60000, durationSec: 10, volume: 'low' },
      { delayMs: 120000, durationSec: 20, volume: 'medium' },
      { delayMs: 180000, durationSec: 60, volume: 'high' }
    ],
    melody: 10
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

    bot = doorAlarm('testDoorAlarm', defaultConfig)
    persistedCache = {
      doorState: null,
      doorOpenTime: null,
      pendingAlarms: []
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  describe('configuration validation', () => {
    it('should throw error if doorSensor.statusTopic is missing', () => {
      expect(() => {
        doorAlarm('test', { ...defaultConfig, doorSensor: {} })
      }).toThrow('doorSensor.statusTopic is required')
    })

    it('should throw error if alarmDevice.commandTopic is missing', () => {
      expect(() => {
        doorAlarm('test', { ...defaultConfig, alarmDevice: {} })
      }).toThrow('alarmDevice.commandTopic is required')
    })

    it('should throw error if escalationSteps is missing', () => {
      expect(() => {
        doorAlarm('test', { ...defaultConfig, escalationSteps: undefined })
      }).toThrow('escalationSteps must be a non-empty array')
    })

    it('should throw error if escalationSteps is empty array', () => {
      expect(() => {
        doorAlarm('test', { ...defaultConfig, escalationSteps: [] })
      }).toThrow('escalationSteps must be a non-empty array')
    })

    it('should throw error if escalationSteps is not an array', () => {
      expect(() => {
        doorAlarm('test', { ...defaultConfig, escalationSteps: 'invalid' })
      }).toThrow('escalationSteps must be a non-empty array')
    })

    it('should throw error if step.delayMs is invalid', () => {
      expect(() => {
        doorAlarm('test', {
          ...defaultConfig,
          escalationSteps: [{ delayMs: 'invalid', durationSec: 10, volume: 'low' }]
        })
      }).toThrow('delayMs must be a positive number')
    })

    it('should throw error if step.durationSec is invalid', () => {
      expect(() => {
        doorAlarm('test', {
          ...defaultConfig,
          escalationSteps: [{ delayMs: 60000, durationSec: 'invalid', volume: 'low' }]
        })
      }).toThrow('durationSec must be a positive number')
    })

    it('should throw error if step.volume is invalid', () => {
      expect(() => {
        doorAlarm('test', {
          ...defaultConfig,
          escalationSteps: [{ delayMs: 60000, durationSec: 10, volume: 'super-loud' }]
        })
      }).toThrow("volume must be 'low', 'medium', or 'high'")
    })
  })

  describe('initialization', () => {
    it('should subscribe to door sensor topic', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledWith(
        'homy/features/open/front_main_door_open/status',
        expect.any(Function)
      )
    })

    it('should initialize persistent cache structure', () => {
      expect(bot.persistedCache.default).toEqual({
        doorState: null,
        doorOpenTime: null,
        pendingAlarms: []
      })
    })
  })

  describe('payload validation', () => {
    it('should handle null payload gracefully', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', null)
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle undefined payload gracefully', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', undefined)
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle missing state property', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', {})
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle non-boolean state value (string)', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: 'true' })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle non-boolean state value (number)', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: 1 })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('duplicate message handling', () => {
    it('should ignore duplicate door open messages', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      bot = doorAlarm('testDoorAlarm', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testDoorAlarm]'),
        expect.stringContaining('duplicate door open message')
      )

      jest.advanceTimersByTime(60000)

      // Should only trigger alarm once despite multiple open messages
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)

      consoleSpy.mockRestore()
    })

    it('should ignore duplicate door closed messages', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      bot = doorAlarm('testDoorAlarm', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testDoorAlarm]'),
        expect.stringContaining('duplicate door closed message')
      )

      consoleSpy.mockRestore()
    })

    it('should not schedule duplicate timers for duplicate messages', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Send multiple open messages
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })

      jest.advanceTimersByTime(180000)

      // Should only trigger 3 alarms (one set), not 9 (three sets)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(3)
    })
  })

  describe('MQTT publish error handling', () => {
    it('should handle MQTT publish failures gracefully', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      mockMqtt.publish = jest.fn().mockRejectedValue(new Error('MQTT broker offline'))

      bot = doorAlarm('testDoorAlarm', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      // Wait for promise rejection to be handled
      await Promise.resolve()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testDoorAlarm]'),
        expect.stringContaining('failed to publish alarm'),
        expect.stringContaining('MQTT broker offline')
      )

      consoleSpy.mockRestore()
    })

    it('should continue escalation even if one alarm publish fails', async () => {
      let publishCount = 0
      mockMqtt.publish = jest.fn().mockImplementation(() => {
        publishCount++
        if (publishCount === 1) {
          return Promise.reject(new Error('First alarm failed'))
        }
        return Promise.resolve()
      })

      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(180000)

      // All three alarms should attempt to publish
      expect(mockMqtt.publish).toHaveBeenCalledTimes(3)
    })
  })

  describe('door open detection', () => {
    it('should not trigger alarm immediately when door opens', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should trigger first alarm after 1 minute with low volume for 10 seconds', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        {
          alarm: true,
          volume: 'low',
          duration: 10,
          melody: 10
        }
      )
    })

    it('should trigger second alarm after 2 minutes with medium volume for 20 seconds', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(120000)

      expect(mockMqtt.publish).toHaveBeenCalledTimes(2)
      expect(mockMqtt.publish).toHaveBeenNthCalledWith(
        2,
        'z2m/house1/floor1-alarm/set',
        {
          alarm: true,
          volume: 'medium',
          duration: 20,
          melody: 10
        }
      )
    })

    it('should trigger third alarm after 3 minutes with high volume for 60 seconds', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).toHaveBeenCalledTimes(3)
      expect(mockMqtt.publish).toHaveBeenNthCalledWith(
        3,
        'z2m/house1/floor1-alarm/set',
        {
          alarm: true,
          volume: 'high',
          duration: 60,
          melody: 10
        }
      )
    })

    it('should not trigger more alarms after final escalation step', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(240000) // 4 minutes

      expect(mockMqtt.publish).toHaveBeenCalledTimes(3)
    })

    it('should persist door state when door opens', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })

      expect(persistedCache.doorState).toBe(true)
      expect(persistedCache.doorOpenTime).toBeGreaterThan(0)
      expect(persistedCache.pendingAlarms).toHaveLength(3)
    })
  })

  describe('door close handling', () => {
    it('should cancel all timers when door closes', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(30000) // 30 seconds

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      // Wait for async cancelAlarms to complete
      await Promise.resolve()

      jest.advanceTimersByTime(180000) // Fast forward past all timers

      // Should publish alarm OFF command when door closes
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        { alarm: false }
      )
    })

    it('should cancel timers even after first alarm has triggered', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(90000) // 1.5 minutes - after first alarm

      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      mockMqtt.publish.mockClear()

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      // Wait for async cancelAlarms to complete
      await Promise.resolve()

      jest.advanceTimersByTime(180000) // Fast forward

      // Should publish alarm OFF command
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        { alarm: false }
      )
    })

    it('should restart escalation if door opens again after closing', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // First open/close cycle
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(30000)
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      // Wait for async cancelAlarms to complete
      await Promise.resolve()

      mockMqtt.publish.mockClear()

      // Second open
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      // Should trigger first alarm again (not second)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        expect.objectContaining({
          volume: 'low',
          duration: 10
        })
      )
    })

    it('should clear persisted state when door closes', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      // Wait for async cancelAlarms to complete
      await Promise.resolve()

      expect(persistedCache.doorState).toBe(false)
      expect(persistedCache.doorOpenTime).toBeNull()
      expect(persistedCache.pendingAlarms).toHaveLength(0)
    })

    it('should stop currently sounding alarm when door closes', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Open door and let first alarm trigger
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      // First alarm should have triggered
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        expect.objectContaining({ alarm: true })
      )

      mockMqtt.publish.mockClear()

      // Close door while alarm is sounding
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      // Wait for async cancelAlarms to complete
      await Promise.resolve()

      // Should send alarm OFF command
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        { alarm: false }
      )
    })

    it('should handle alarm stop failure gracefully', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      mockMqtt.publish = jest.fn().mockRejectedValue(new Error('Device offline'))

      bot = doorAlarm('testDoorAlarm', verboseConfig)
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

      // Wait for async cancelAlarms to complete
      await Promise.resolve()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testDoorAlarm]'),
        expect.stringContaining('failed to stop alarm'),
        expect.stringContaining('Device offline')
      )

      consoleSpy.mockRestore()
    })
  })

  describe('state persistence and restoration', () => {
    it('should restore timers after service restart with door still open', async () => {
      // Simulate door opened 30 seconds ago
      const doorOpenTime = Date.now() - 30000
      persistedCache.doorState = true
      persistedCache.doorOpenTime = doorOpenTime
      persistedCache.pendingAlarms = [
        { stepIndex: 0, scheduledTime: doorOpenTime + 60000, triggered: false },
        { stepIndex: 1, scheduledTime: doorOpenTime + 120000, triggered: false },
        { stepIndex: 2, scheduledTime: doorOpenTime + 180000, triggered: false }
      ]

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // First alarm should trigger in 30 seconds (60s - 30s elapsed)
      jest.advanceTimersByTime(30000)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)

      // Second alarm should trigger 60 seconds later
      jest.advanceTimersByTime(60000)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(2)

      // Third alarm should trigger 60 seconds later
      jest.advanceTimersByTime(60000)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(3)
    })

    it('should trigger expired alarms immediately after restart', async () => {
      // Simulate door opened 5 minutes ago (all alarms should have fired)
      const doorOpenTime = Date.now() - 300000
      persistedCache.doorState = true
      persistedCache.doorOpenTime = doorOpenTime
      persistedCache.pendingAlarms = [
        { stepIndex: 0, scheduledTime: doorOpenTime + 60000, triggered: false },
        { stepIndex: 1, scheduledTime: doorOpenTime + 120000, triggered: false },
        { stepIndex: 2, scheduledTime: doorOpenTime + 180000, triggered: false }
      ]

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Wait for promises to resolve
      await Promise.resolve()
      await Promise.resolve()

      // All three alarms should trigger immediately
      expect(mockMqtt.publish).toHaveBeenCalledTimes(3)
    })

    it('should not restore alarms that already triggered', async () => {
      // Simulate door opened 90 seconds ago, first alarm already triggered
      const doorOpenTime = Date.now() - 90000
      persistedCache.doorState = true
      persistedCache.doorOpenTime = doorOpenTime
      persistedCache.pendingAlarms = [
        { stepIndex: 0, scheduledTime: doorOpenTime + 60000, triggered: true },  // Already fired
        { stepIndex: 1, scheduledTime: doorOpenTime + 120000, triggered: false },
        { stepIndex: 2, scheduledTime: doorOpenTime + 180000, triggered: false }
      ]

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // First alarm should not trigger again
      jest.advanceTimersByTime(1000)
      expect(mockMqtt.publish).not.toHaveBeenCalled()

      // Second alarm should trigger in 30 seconds (120s - 90s elapsed)
      jest.advanceTimersByTime(29000)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        expect.objectContaining({
          volume: 'medium'
        })
      )
    })

    it('should not restore timers if door was closed', async () => {
      persistedCache.doorState = false
      persistedCache.doorOpenTime = null
      persistedCache.pendingAlarms = []

      await bot.start({ mqtt: mockMqtt, persistedCache })

      jest.advanceTimersByTime(180000)

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('custom configuration', () => {
    it('should support custom escalation steps', async () => {
      const customConfig = {
        ...defaultConfig,
        escalationSteps: [
          { delayMs: 30000, durationSec: 5, volume: 'medium' }
        ]
      }

      bot = doorAlarm('testDoorAlarm', customConfig)
      persistedCache = { doorState: null, doorOpenTime: null, pendingAlarms: [] }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(30000)

      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        expect.objectContaining({
          volume: 'medium',
          duration: 5
        })
      )
    })

    it('should support custom melody', async () => {
      const customConfig = {
        ...defaultConfig,
        melody: 5
      }

      bot = doorAlarm('testDoorAlarm', customConfig)
      persistedCache = { doorState: null, doorOpenTime: null, pendingAlarms: [] }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'z2m/house1/floor1-alarm/set',
        expect.objectContaining({
          melody: 5
        })
      )
    })
  })

  describe('verbose logging', () => {
    it('should log events when verbose is enabled', async () => {
      const verboseConfig = { ...defaultConfig, verbose: true }
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      bot = doorAlarm('testDoorAlarm', verboseConfig)
      persistedCache = { doorState: null, doorOpenTime: null, pendingAlarms: [] }
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[testDoorAlarm]'),
        expect.stringContaining('door opened')
      )

      consoleSpy.mockRestore()
    })

    it('should not log when verbose is disabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      await bot.start({ mqtt: mockMqtt, persistedCache })
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })

      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('should handle rapid door open/close cycles', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      for (let i = 0; i < 5; i++) {
        await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
        jest.advanceTimersByTime(5000)
        await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })

        // Wait for async cancelAlarms to complete
        await Promise.resolve()

        jest.advanceTimersByTime(5000)
      }

      // Should send alarm OFF command for each close (no alarm ON commands since timers never reached)
      expect(mockMqtt.publish).toHaveBeenCalledTimes(5)
      mockMqtt.publish.mock.calls.forEach(call => {
        expect(call[1]).toEqual({ alarm: false })
      })
    })

    it('should handle door already open on startup', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
    })
  })
})
