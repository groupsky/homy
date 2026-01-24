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
    persistedCache = {}
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  describe('initialization', () => {
    it('should subscribe to door sensor topic', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledWith(
        'homy/features/open/front_main_door_open/status',
        expect.any(Function)
      )
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
          alarm: 'ON',
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
          alarm: 'ON',
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
          alarm: 'ON',
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
  })

  describe('door close handling', () => {
    it('should cancel all timers when door closes', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(30000) // 30 seconds

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })
      jest.advanceTimersByTime(180000) // Fast forward past all timers

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should cancel timers even after first alarm has triggered', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(90000) // 1.5 minutes - after first alarm

      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
      mockMqtt.publish.mockClear()

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })
      jest.advanceTimersByTime(180000) // Fast forward

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should restart escalation if door opens again after closing', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      // First open/close cycle
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(30000)
      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: false })
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
        jest.advanceTimersByTime(5000)
      }

      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle door already open on startup', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      await mockMqtt._triggerMessage('homy/features/open/front_main_door_open/status', { state: true })
      jest.advanceTimersByTime(60000)

      expect(mockMqtt.publish).toHaveBeenCalledTimes(1)
    })
  })
})
