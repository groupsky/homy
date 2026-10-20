const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')
const createBac002TogglePower = require('./bac002-toggle-power')

describe('bac002-toggle-power bot', () => {
  // A room is switched off only after a contact has been open this long (#1797)
  const OPEN_DELAY_MS = 30 * 1000
  let mockMqtt
  let bot
  let persistedCache
  let config

  beforeEach(() => {
    jest.useFakeTimers()

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
    jest.useRealTimers()
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

    it('should turn off power when it is on and at least one switch is open for 30 s', async () => {
      // Open one switch
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      jest.advanceTimersByTime(OPEN_DELAY_MS)

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

      // 2. Open a switch for 30 s - power should turn off
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      jest.advanceTimersByTime(OPEN_DELAY_MS)
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
      // Open first switch for 30 s
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      jest.advanceTimersByTime(OPEN_DELAY_MS)
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
      jest.advanceTimersByTime(OPEN_DELAY_MS)
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

      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      jest.advanceTimersByTime(OPEN_DELAY_MS)

      // Should throw since there's no error handling in the bot (documenting current behavior)
      expect(() => mockMqtt._triggerMessage('modbus/1/3/reading', { power: 'on' })).toThrow('MQTT publish failed')
    })

    it('should publish correct command format', async () => {
      await mockMqtt._triggerMessage('homy/features/open/window1/status', { state: true })
      jest.advanceTimersByTime(OPEN_DELAY_MS)

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

    let create

    beforeEach(async () => {
      // A fresh module, so the alert batch shared by the bots starts empty.
      jest.resetModules()
      create = require('./bac002-toggle-power')
      httpPost = jest.fn().mockResolvedValue({ok: true})
      staleBot = create('toggleRoomPower', {...config, httpPost})
      await staleBot.start({mqtt: mockMqtt, persistedCache})
    })

    it('does not switch on states kept from before the start', async () => {
      persistedCache.switchStates = [true, false]

      await mockMqtt._triggerMessage(READING, {power: 'on'})

      expect(writes()).toEqual([])
    })

    it('does not switch the room on from states kept from before the start', async () => {
      persistedCache.switchStates = [false, false]
      persistedCache.wasOn = true

      await mockMqtt._triggerMessage(READING, {power: 'off'})

      expect(writes()).toEqual([])
    })

    it('switches off on fresh data with a window open for 30 s', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      jest.advanceTimersByTime(OPEN_DELAY_MS)
      await mockMqtt._triggerMessage(READING, {power: 'on'})

      expect(writes()).toEqual(['off'])
    })

    it('stops forcing the thermostat off when the contact data is older than 10 min', async () => {
      await mockMqtt._triggerMessage(WINDOW, {state: true})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      jest.advanceTimersByTime(OPEN_DELAY_MS)
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
      expect(alerts()[0]).toContain('No contact data for 10 min: toggleRoomPower.')
      expect(httpPost.mock.calls[0][1].source).toBe('bac002-toggle-power')

      await mockMqtt._triggerMessage(WINDOW, {state: false})
      await mockMqtt._triggerMessage(DOOR, {state: false})
      jest.advanceTimersByTime(5 * MIN)

      expect(alerts()).toHaveLength(2)
      expect(alerts()[1]).toContain('Contact data is back: toggleRoomPower.')
    })

    // All thermostat bots read the same contact reader: one cause, one message.
    it('sends one message that lists every room on the same outage', async () => {
      const other = create('toggleOtherRoomPower', {...config, httpPost})
      await other.start({mqtt: mockMqtt, persistedCache: {switchStates: [false, false], wasOn: false}})
      await mockMqtt._triggerMessage(WINDOW, {state: false})
      await mockMqtt._triggerMessage(DOOR, {state: false})

      jest.advanceTimersByTime(60 * MIN)

      expect(alerts()).toHaveLength(1)
      expect(alerts()[0]).toContain('toggleRoomPower, toggleOtherRoomPower')
    })

    it('sends nothing for a disabled bot', async () => {
      const disabled = create('toggleDisabledPower', {...config, httpPost})
      await disabled.start({mqtt: mockMqtt, persistedCache: {switchStates: [false, false], wasOn: false}, isEnabled: () => false})

      jest.advanceTimersByTime(60 * MIN)

      expect(alerts().join(' ')).not.toContain('toggleDisabledPower')
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

  // When the mains dips, the contact modules read every input open for about
  // 10 s. A room is switched off only when a contact stays open for
  // openDelayMs (30 s), so a dip does not switch rooms off and on (#1797).
  describe('open delay', () => {
    const SEC = 1000
    const MODULE1 = '/modbus/dry-switches/mbsl32di1/reading'
    const MODULE2 = '/modbus/dry-switches/mbsl32di2/reading'
    const ROOM_A = '/modbus/monitoring/thermostat-a'
    const ROOM_B = '/modbus/monitoring/thermostat-b'
    // A contact is open when its bit is 0. The modules have more inputs; only
    // the bits of the two rooms are set here.
    const contact = (bit) => ({ inputs }) => !(inputs & (1 << bit))
    const ROOM_A_DOOR = 3
    const ROOM_A_WINDOW = 4
    const ROOM_B_DOOR = 5
    const ROOM_B_WINDOW = 2
    const CLOSED1 = (1 << ROOM_A_DOOR) | (1 << ROOM_A_WINDOW) | (1 << ROOM_B_DOOR)
    const CLOSED2 = 1 << ROOM_B_WINDOW
    // Two rooms: one with door and window on the same module, one with a
    // contact on each module. Several bots read the same module.
    const rooms = {
      toggleRoomAPower: {
        bacTopic: ROOM_A,
        switches: [
          { topic: MODULE1, isOpen: contact(ROOM_A_DOOR) },
          { topic: MODULE1, isOpen: contact(ROOM_A_WINDOW) },
        ]
      },
      toggleRoomBPower: {
        bacTopic: ROOM_B,
        switches: [
          { topic: MODULE1, isOpen: contact(ROOM_B_DOOR) },
          { topic: MODULE2, isOpen: contact(ROOM_B_WINDOW) },
        ]
      },
    }

    let create
    let httpPost
    let subscribers
    let mqtt
    // A thermostat reads the power last written to it; it starts on.
    let power
    let writes

    beforeEach(() => {
      jest.setSystemTime(Date.parse('2026-10-10T06:39:59.000Z'))
      // A fresh module, so the alert batches shared by the bots start empty.
      jest.resetModules()
      create = require('./bac002-toggle-power')
      httpPost = jest.fn().mockResolvedValue({ok: true})
      subscribers = {}
      power = { [ROOM_A]: 'on', [ROOM_B]: 'on' }
      writes = []
      mqtt = {
        subscribe: jest.fn(async (topic, callback) => {
          subscribers[topic] = [...(subscribers[topic] || []), callback]
        }),
        publish: jest.fn(async (topic, payload) => {
          writes.push({ at: Date.now(), topic, power: payload.power })
          power[topic.replace(/\/write$/, '')] = payload.power
        }),
      }
    })

    const startRoom = async (name, options = {}, persistedCache) => {
      const bot = create(name, { ...rooms[name], httpPost, ...options })
      await bot.start({ mqtt, persistedCache: persistedCache || structuredClone(bot.persistedCache.default) })
    }
    const startRooms = async (options) => {
      for (const name of Object.keys(rooms)) await startRoom(name, options)
    }
    // Delivers a reading to every bot that reads the topic. It was made now,
    // unless the payload has its own _tz.
    const send = (topic, payload) => {
      for (const callback of subscribers[topic] || []) callback({ _tz: Date.now(), ...payload })
    }
    const readThermostats = () => {
      send(`${ROOM_A}/reading`, { power: power[ROOM_A] })
      send(`${ROOM_B}/reading`, { power: power[ROOM_B] })
    }
    // Both thermostats report once a second, as they do.
    const readThermostatsFor = (seconds) => {
      for (let i = 0; i < seconds; i++) {
        jest.advanceTimersByTime(SEC)
        readThermostats()
      }
    }
    const allClosed = () => {
      send(MODULE1, { inputs: CLOSED1 })
      send(MODULE2, { inputs: CLOSED2 })
    }
    const openRoomAWindow = () => send(MODULE1, { inputs: CLOSED1 & ~(1 << ROOM_A_WINDOW) })

    describe('replay of the mains dip of 2026-10-10', () => {
      const at = (time) => Date.parse(`2026-10-10T${time}Z`)
      // Both contact modules read 0 (every contact open) from 06:43:30.4 to
      // 06:43:40.1 UTC; the normal value is back right after. Here they also
      // read 0 once a second in between. Before the dip a module reports its
      // state at least every 5 min. The thermostats did not restart: they kept
      // reading power on about once a second.
      const dipReadings = () => {
        const readings = []
        const add = (time, topic, payload) => readings.push({ time, topic, payload })
        add(at('06:40:00.000'), MODULE1, { inputs: CLOSED1 })
        add(at('06:40:00.050'), MODULE2, { inputs: CLOSED2 })
        for (let time = at('06:40:01.000'); time <= at('06:44:30.000'); time += SEC) {
          add(time, `${ROOM_A}/reading`, null)
          add(time + 500, `${ROOM_B}/reading`, null)
        }
        for (const time of [...Array.from({ length: 10 }, (_, i) => at('06:43:30.400') + i * SEC), at('06:43:40.100')]) {
          add(time, MODULE1, { inputs: 0 })
          add(time + 20, MODULE2, { inputs: 0 })
        }
        add(at('06:43:40.200'), MODULE1, { inputs: CLOSED1 })
        add(at('06:43:40.220'), MODULE2, { inputs: CLOSED2 })
        return readings.sort((a, b) => a.time - b.time)
      }
      const replay = () => {
        for (const { time, topic, payload } of dipReadings()) {
          jest.advanceTimersByTime(time - Date.now())
          // A thermostat reading shows the power the unit has now.
          send(topic, payload || { power: power[topic.replace(/\/reading$/, '')] })
        }
      }

      it('switches no room off or on', async () => {
        await startRooms()

        replay()

        expect(writes).toEqual([])
      })

      // Shows that the replay is the incident: with no delay it switches both
      // rooms off and on again, as the bot did on 2026-10-10.
      it('switched both rooms off and on with no delay, as before', async () => {
        await startRooms({ openDelayMs: 0 })

        replay()

        expect(writes.map(({ topic, power }) => `${topic} ${power}`)).toEqual([
          `${ROOM_B}/write off`,
          `${ROOM_A}/write off`,
          `${ROOM_B}/write on`,
          `${ROOM_A}/write on`,
        ])
      })
    })

    it('switches a room off when its window stays open for 30 s, not before', async () => {
      await startRooms()
      allClosed()
      readThermostatsFor(5)

      openRoomAWindow()
      const openedAt = Date.now()
      readThermostatsFor(29)
      expect(writes).toEqual([])

      readThermostatsFor(1)
      expect(writes).toEqual([{ at: openedAt + 30 * SEC, topic: `${ROOM_A}/write`, power: 'off' }])
    })

    it('starts the 30 s again when the window closes in between', async () => {
      await startRooms()
      allClosed()

      openRoomAWindow()
      readThermostatsFor(20)
      allClosed()
      readThermostatsFor(1)
      openRoomAWindow()
      const openedAgainAt = Date.now()
      readThermostatsFor(20)
      expect(writes).toEqual([])

      readThermostatsFor(10)
      expect(writes).toEqual([{ at: openedAgainAt + 30 * SEC, topic: `${ROOM_A}/write`, power: 'off' }])
    })

    it('keeps the time of an open contact while other contacts on its module change', async () => {
      await startRooms()
      allClosed()

      send(MODULE1, { inputs: CLOSED1 & ~(1 << ROOM_A_DOOR) })
      const openedAt = Date.now()
      readThermostatsFor(10)
      // The other room's door opens and closes: the module reports twice more,
      // with room A's door still open.
      send(MODULE1, { inputs: CLOSED1 & ~(1 << ROOM_A_DOOR) & ~(1 << ROOM_B_DOOR) })
      readThermostatsFor(10)
      send(MODULE1, { inputs: CLOSED1 & ~(1 << ROOM_A_DOOR) })
      readThermostatsFor(10)

      expect(writes).toEqual([{ at: openedAt + 30 * SEC, topic: `${ROOM_A}/write`, power: 'off' }])
    })

    // The time is the one in the thermostat reading, not when it arrives.
    it('counts to the time the thermostat reading was made', async () => {
      await startRooms()
      allClosed()
      openRoomAWindow()
      const openedAt = Date.now()

      // A reading made 10 s after the open arrives 40 s after it.
      jest.advanceTimersByTime(40 * SEC)
      send(`${ROOM_A}/reading`, { power: 'on', _tz: openedAt + 10 * SEC })

      expect(writes).toEqual([])
    })

    it('switches the room on again as soon as every contact is closed', async () => {
      await startRooms()
      allClosed()
      openRoomAWindow()
      readThermostatsFor(35)
      expect(writes.map(({ power }) => power)).toEqual(['off'])

      allClosed()
      readThermostats()

      expect(writes).toEqual([
        expect.objectContaining({ power: 'off' }),
        { at: Date.now(), topic: `${ROOM_A}/write`, power: 'on' },
      ])
    })

    // The open times are kept in memory only. After a restart the count starts
    // at the first open reading, so an off can come up to 30 s later.
    it('counts from the first open reading after a restart', async () => {
      await startRoom('toggleRoomAPower', {}, { switchStates: [false, true], wasOn: false })
      readThermostatsFor(20)

      openRoomAWindow()
      const openedAt = Date.now()
      readThermostatsFor(29)
      expect(writes).toEqual([])

      readThermostatsFor(1)
      expect(writes).toEqual([{ at: openedAt + 30 * SEC, topic: `${ROOM_A}/write`, power: 'off' }])
    })
  })
})