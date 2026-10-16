const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')
const createBac002TogglePower = require('./bac002-toggle-power')

describe('bac002-toggle-power bot', () => {
  let mockMqtt
  let bot
  let persistedCache
  let config

  beforeEach(() => {
    // Mock MQTT interface
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

    // Default test configuration
    config = {
      bacTopic: 'modbus/1/3',
      switches: [
        { topic: 'homy/features/open/window1/status', isOpen: (payload) => payload.state === true },
        { topic: 'homy/features/open/door1/status', isOpen: (payload) => payload.state === true }
      ]
    }

    bot = createBac002TogglePower('test-bac002', config)

    // Initialize persistedCache with the bot's default state
    persistedCache = {
      switchStates: new Array(config.switches.length).fill(false),
      wasOn: false
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  // Every contact reports "closed" once, as the readers do within minutes of a
  // start. The bot acts only on contact data it has seen fresh (#1743).
  const reportContactsClosed = async () => {
    for (const { topic } of config.switches) {
      await mockMqtt._triggerMessage(topic, { state: false })
    }
  }

  describe('initialization', () => {
    it('should have persistedCache configuration', () => {
      expect(bot.persistedCache).toBeDefined()
      expect(bot.persistedCache.version).toBe(1)
      expect(bot.persistedCache.default).toEqual({
        switchStates: [false, false],
        wasOn: false
      })
    })

    it('should initialize with correct number of switch states', () => {
      const singleSwitchConfig = {
        bacTopic: 'modbus/1/3',
        switches: [
          { topic: 'homy/features/open/window1/status', isOpen: (payload) => payload.state === true }
        ]
      }
      const singleSwitchBot = createBac002TogglePower('single', singleSwitchConfig)

      expect(singleSwitchBot.persistedCache.default.switchStates).toEqual([false])
    })

    it('should subscribe to all configured switch topics and BAC reading topic', async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledTimes(3)
      expect(mockMqtt.subscribe).toHaveBeenCalledWith('homy/features/open/window1/status', expect.any(Function))
      expect(mockMqtt.subscribe).toHaveBeenCalledWith('homy/features/open/door1/status', expect.any(Function))
      expect(mockMqtt.subscribe).toHaveBeenCalledWith('modbus/1/3/reading', expect.any(Function))
    })
  })

  describe('switch state tracking', () => {
    beforeEach(async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })
    })

    it('should update switch state when switch opens', async () => {
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })

      expect(persistedCache.switchStates[0]).toBe(true)
      expect(persistedCache.switchStates[1]).toBe(false)
    })

    it('should update switch state when switch closes', async () => {
      // First open the switch
      persistedCache.switchStates[0] = true

      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: false })

      expect(persistedCache.switchStates[0]).toBe(false)
    })

    it('should track multiple switches independently', async () => {
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      await mockMqtt._triggerMessage('homy/features/open/door1/status', { state: true })

      expect(persistedCache.switchStates[0]).toBe(true)
      expect(persistedCache.switchStates[1]).toBe(true)
    })

    it('should handle custom isOpen functions', async () => {
      const customConfig = {
        bacTopic: 'modbus/1/3',
        switches: [
          {
            topic: 'custom/topic',
            isOpen: (payload) => payload.value === 'open'
          }
        ]
      }
      const customBot = createBac002TogglePower('custom', customConfig)
      const customCache = { switchStates: [false], wasOn: false }

      await customBot.start({ mqtt: mockMqtt, persistedCache: customCache })
      await mockMqtt._triggerMessage('custom/topic', { value: 'open' })

      expect(customCache.switchStates[0]).toBe(true)
    })
  })

  describe('power control logic', () => {
    beforeEach(async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })
      await reportContactsClosed()
    })

    it('should turn off power when it is on and at least one switch is open', async () => {
      // Open one switch
      persistedCache.switchStates[0] = true

      // Trigger power reading with power on
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })

      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'off' })
      expect(persistedCache.wasOn).toBe(true)
    })

    it('should not turn off power when it is on but all switches are closed', async () => {
      // All switches closed (default state)
      expect(persistedCache.switchStates.every(state => !state)).toBe(true)

      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
      expect(persistedCache.wasOn).toBe(false)
    })

    it('should turn on power when it was previously on, is currently off, and all switches are closed', async () => {
      // Set up state: power was on, all switches closed
      persistedCache.wasOn = true

      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })

      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'on' })
      expect(persistedCache.wasOn).toBe(false)
    })

    it('should not turn on power when it was not previously on', async () => {
      // wasOn is false by default
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
      expect(persistedCache.wasOn).toBe(false)
    })

    it('should not turn on power when switches are still open', async () => {
      persistedCache.wasOn = true
      persistedCache.switchStates[0] = true // One switch open

      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })

      expect(mockMqtt.publish).not.toHaveBeenCalled()
      expect(persistedCache.wasOn).toBe(true) // Should remain true
    })
  })

  describe('complete power cycle scenarios', () => {
    beforeEach(async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })
      await reportContactsClosed()
    })

    it('should handle complete open-close cycle', async () => {
      // 1. Power is on, all switches closed - no action
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })
      expect(mockMqtt.publish).not.toHaveBeenCalled()

      // 2. Open a switch - power should turn off
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })
      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'off' })
      expect(persistedCache.wasOn).toBe(true)

      // 3. Close the switch - no immediate action
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: false })
      mockMqtt.publish.mockClear()

      // 4. Power reading shows off, all switches closed - power should turn on
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })
      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'on' })
      expect(persistedCache.wasOn).toBe(false)
    })

    it('should handle multiple switches opening and closing', async () => {
      // Open first switch
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })
      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'off' })
      mockMqtt.publish.mockClear()

      // Open second switch while first is still open
      await mockMqtt._triggerMessage('homy/features/open/door1/status', { state: true })
      mockMqtt.publish.mockClear() // Clear previous calls
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })
      // Will call publish again because power is still 'on' and switches are open (current behavior)
      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'off' })

      // Close first switch (second still open)
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: false })
      mockMqtt.publish.mockClear() // Clear previous calls
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })
      // Should not turn on yet - second switch still open
      expect(mockMqtt.publish).not.toHaveBeenCalled()

      // Close second switch (all closed)
      await mockMqtt._triggerMessage('homy/features/open/door1/status', { state: false })
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })
      // Now should turn on
      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'on' })
    })
  })

  describe('edge cases and error handling', () => {
    beforeEach(async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })
      await reportContactsClosed()
    })

    it('should handle null payload (documents current behavior)', async () => {
      // Current behavior: isOpen function will throw on null payload - this is expected
      expect(() => mockMqtt._triggerMessage('homy/features/open/window1/status', null)).toThrow()
      // Power reading with null should not throw since we check payload.power
      expect(() => mockMqtt._triggerMessage('modbus/1/3/reading', null)).toThrow()
    })

    it('should handle undefined payload (documents current behavior)', async () => {
      // Current behavior: isOpen function will throw on undefined payload - this is expected
      expect(() => mockMqtt._triggerMessage('homy/features/open/window1/status', undefined)).toThrow()
      // Power reading with undefined should not throw since we check payload.power
      expect(() => mockMqtt._triggerMessage('modbus/1/3/reading', undefined)).toThrow()
    })

    it('should handle payload without expected properties', async () => {
      expect(() => mockMqtt._triggerMessage('homy/features/open/window1/status', {})).not.toThrow()
      expect(() => mockMqtt._triggerMessage('modbus/1/3/reading', {})).not.toThrow()
    })

    it('should handle isOpen function throwing error', async () => {
      const errorConfig = {
        bacTopic: 'modbus/1/3',
        switches: [
          {
            topic: 'error/topic',
            isOpen: () => { throw new Error('Test error') }
          }
        ]
      }
      const errorBot = createBac002TogglePower('error', errorConfig)
      const errorCache = { switchStates: [false], wasOn: false }

      await errorBot.start({ mqtt: mockMqtt, persistedCache: errorCache })

      expect(() => mockMqtt._triggerMessage('error/topic', { state: true })).toThrow('Test error')
    })

    it('should handle power values other than on/off', async () => {
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'unknown' })
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: null })
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 123 })

      // Should not publish anything for unknown power states
      expect(mockMqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('configuration variants', () => {
    it('should work with single switch', async () => {
      const singleConfig = {
        bacTopic: 'modbus/2/5',
        switches: [
          { topic: 'single/switch', isOpen: (p) => p.open }
        ]
      }
      const singleBot = createBac002TogglePower('single', singleConfig)
      const singleCache = { switchStates: [false], wasOn: false }

      await singleBot.start({ mqtt: mockMqtt, persistedCache: singleCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledWith('single/switch', expect.any(Function))
      expect(mockMqtt.subscribe).toHaveBeenCalledWith('modbus/2/5/reading', expect.any(Function))
    })

    it('should work with many switches', async () => {
      const manyConfig = {
        bacTopic: 'modbus/1/1',
        switches: new Array(5).fill(0).map((_, i) => ({
          topic: `switch/${i}`,
          isOpen: (p) => p.state
        }))
      }
      const manyBot = createBac002TogglePower('many', manyConfig)
      const manyCache = { switchStates: new Array(5).fill(false), wasOn: false }

      await manyBot.start({ mqtt: mockMqtt, persistedCache: manyCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledTimes(6) // 5 switches + 1 reading topic
    })

    it('should work with different topic patterns', async () => {
      const customConfig = {
        bacTopic: 'custom/bac/device',
        switches: [
          { topic: 'zigbee/0x123/contact', isOpen: (p) => p.contact === false }
        ]
      }
      const customBot = createBac002TogglePower('custom', customConfig)
      const customCache = { switchStates: [false], wasOn: false }

      await customBot.start({ mqtt: mockMqtt, persistedCache: customCache })

      expect(mockMqtt.subscribe).toHaveBeenCalledWith('zigbee/0x123/contact', expect.any(Function))
      expect(mockMqtt.subscribe).toHaveBeenCalledWith('custom/bac/device/reading', expect.any(Function))
    })
  })

  describe('persistent state behavior', () => {
    beforeEach(async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })
      await reportContactsClosed()
    })

    it('should maintain state across simulated restarts', async () => {
      // Simulate some activity
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })

      expect(persistedCache.switchStates[0]).toBe(true)
      expect(persistedCache.wasOn).toBe(true)

      // Create new bot instance with same state (simulates restart)
      const newBot = createBac002TogglePower('test-bac002', config)
      await newBot.start({ mqtt: mockMqtt, persistedCache })

      // State should be preserved
      expect(persistedCache.switchStates[0]).toBe(true)
      expect(persistedCache.wasOn).toBe(true)
    })

    it('should work correctly with restored state', async () => {
      // Simulate restored state from persistence
      persistedCache.switchStates[0] = true
      persistedCache.wasOn = true

      await bot.start({ mqtt: mockMqtt, persistedCache })

      // Close the switch; the door reports again too
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: false })
      await mockMqtt._triggerMessage('homy/features/open/door1/status', { state: false })
      // Power should turn on when reading shows off
      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'off' })

      expect(mockMqtt.publish).toHaveBeenCalledWith('modbus/1/3/write', { power: 'on' })
      expect(persistedCache.wasOn).toBe(false)
    })
  })

  describe('MQTT integration', () => {
    beforeEach(async () => {
      await bot.start({ mqtt: mockMqtt, persistedCache })
      await reportContactsClosed()
    })

    it('should handle MQTT publish failures gracefully', async () => {
      // Mock publish to throw synchronously (simulating connection issues)
      mockMqtt.publish.mockImplementation(() => {
        throw new Error('MQTT publish failed')
      })

      persistedCache.switchStates[0] = true

      // Should throw since there's no error handling in the bot (documenting current behavior)
      expect(() => mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })).toThrow('MQTT publish failed')
    })

    it('should publish correct command format', async () => {
      persistedCache.switchStates[0] = true

      await mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })

      expect(mockMqtt.publish).toHaveBeenCalledWith(
        'modbus/1/3/write',
        { power: 'off' }
      )
    })
  })

  // A reader that stops leaves the last contact state in place. On old data
  // the bot must not keep a room off that a person wants on (#1743).
  describe('old contact data', () => {
    const MIN = 60 * 1000
    const WINDOW = 'homy/features/open/window1/status'
    const DOOR = 'homy/features/open/door1/status'
    const READING = 'modbus/1/3/reading'
    let httpPost
    let staleBot

    const alerts = () => httpPost.mock.calls.map(([, body]) => body.message)
    const writes = () => mockMqtt.publish.mock.calls.map(([, payload]) => payload.power)

    beforeEach(async () => {
      jest.useFakeTimers()
      httpPost = jest.fn().mockResolvedValue({ok: true})
      staleBot = createBac002TogglePower('toggleRoomPower', {...config, httpPost})
      await staleBot.start({mqtt: mockMqtt, persistedCache})
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('does not switch on states kept from before the start', async () => {
      persistedCache.switchStates = [true, false]

      await mockMqtt._triggerMessage(READING, {power: 'on'})

      expect(writes()).toEqual([])
    })

    it('switches off on fresh data with a window open', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      await mockMqtt._triggerMessage(READING, {power: 'on'})

      expect(writes()).toEqual(['off'])
    })

    it('stops forcing the thermostat off when the contact data is older than 10 min', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      await mockMqtt._triggerMessage(READING, {power: 'on'})

      jest.advanceTimersByTime(11 * MIN)
      // A person turns the thermostat on again.
      await mockMqtt._triggerMessage(READING, {power: 'on'})

      expect(writes()).toEqual(['off'])
    })

    it('sends one alert when the data goes stale and one when it returns', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: false})
      await mockMqtt._triggerMessage(DOOR, {state: false})

      jest.advanceTimersByTime(10 * MIN)
      expect(alerts()).toEqual([])

      jest.advanceTimersByTime(60 * MIN)
      expect(alerts()).toHaveLength(1)
      expect(alerts()[0]).toContain('no contact data for 10 min')
      expect(httpPost.mock.calls[0][1].source).toBe('toggleRoomPower')

      await mockMqtt._triggerMessage(WINDOW, {state: false})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      jest.advanceTimersByTime(5 * MIN)

      expect(alerts()).toHaveLength(2)
      expect(alerts()[1]).toContain('contact data is back')
    })

    it('forgets its own switch-off when a person turned the thermostat on and the contacts closed', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      await mockMqtt._triggerMessage(READING, {power: 'on'})
      jest.advanceTimersByTime(30 * MIN)

      // A person turned it on during the gap; the window is closed when data returns.
      await mockMqtt._triggerMessage(WINDOW, {state: false})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      await mockMqtt._triggerMessage(READING, {power: 'on'})
      // Later the person turns it off by hand.
      await mockMqtt._triggerMessage(READING, {power: 'off'})

      expect(writes()).toEqual(['off'])
    })

    it('acts normally again when the data returns', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      jest.advanceTimersByTime(30 * MIN)
      await mockMqtt._triggerMessage(READING, {power: 'on'})
      expect(writes()).toEqual([])

      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      await mockMqtt._triggerMessage(READING, {power: 'on'})

      expect(writes()).toEqual(['off'])
    })
  })
})