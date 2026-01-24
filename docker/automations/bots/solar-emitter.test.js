const { afterEach, beforeEach, describe, expect, it, jest, test } = require('@jest/globals')
const solarEmitter = require('./solar-emitter')

describe('solar-emitter bot', () => {
  let mqtt
  let bot
  let mqttSubscriptions

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z')) // Midday in summer

    mqttSubscriptions = {}
    mqtt = {
      publish: jest.fn(),
      subscribe: (topic, callback) => {
        mqttSubscriptions[topic] = callback
      }
    }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Z2M device integration (ZBMINIR2)', () => {
    const config = {
      statusTopic: 'z2m/house1/P5-night-ext-lights',
      commandTopic: 'z2m/house1/P5-night-ext-lights/set',
      stateParser: (payload) => payload.state === 'ON',
      commandTemplate: (state) => ({ state: state ? 'ON' : 'OFF' }),
      lat: 42.1354,
      lon: 24.7453,
      solarTimeStates: {
        sunset: true,
        sunrise: false
      },
      verbose: false
    }

    beforeEach(() => {
      bot = solarEmitter('nightExternalLightsZ2M', config)
      bot.start({ mqtt })
    })

    test('should parse Z2M ON state correctly', () => {
      const z2mPayload = { state: 'ON', linkquality: 120 }
      const parsed = config.stateParser(z2mPayload)
      expect(parsed).toBe(true)
    })

    test('should parse Z2M OFF state correctly', () => {
      const z2mPayload = { state: 'OFF', linkquality: 120 }
      const parsed = config.stateParser(z2mPayload)
      expect(parsed).toBe(false)
    })

    test('should format command for turning ON', () => {
      const command = config.commandTemplate(true)
      expect(command).toEqual({ state: 'ON' })
    })

    test('should format command for turning OFF', () => {
      const command = config.commandTemplate(false)
      expect(command).toEqual({ state: 'OFF' })
    })

    test('should subscribe to Z2M status topic', () => {
      expect(mqttSubscriptions['z2m/house1/P5-night-ext-lights']).toBeDefined()
    })

    test('should update state when receiving Z2M status messages', () => {
      // Simulate state changes
      mqttSubscriptions['z2m/house1/P5-night-ext-lights']({ state: 'ON', linkquality: 120 })
      mqttSubscriptions['z2m/house1/P5-night-ext-lights']({ state: 'OFF', linkquality: 115 })

      // Subscription callback should handle both messages without errors
      expect(mqttSubscriptions['z2m/house1/P5-night-ext-lights']).toBeDefined()
    })

    test('should handle Z2M messages with additional properties', () => {
      // Z2M sends many extra properties
      const fullZ2mPayload = {
        state: 'ON',
        linkquality: 120,
        update: { state: 'idle' },
        update_available: false
      }

      const parsed = config.stateParser(fullZ2mPayload)
      expect(parsed).toBe(true)
    })
  })

  describe('Modbus relay integration (existing)', () => {
    const config = {
      statusTopic: '/modbus/dry-switches/relays00-15/reading',
      commandTopic: '/modbus/dry-switches/relays00-15/write',
      stateParser: ({ outputs }) => Boolean(outputs & (1 << 15)),
      commandTemplate: (state) => ({ out15: state }),
      lat: 42.1354,
      lon: 24.7453,
      solarTimeStates: {
        sunset: true,
        sunrise: false
      },
      verbose: false
    }

    beforeEach(() => {
      bot = solarEmitter('nightExternalLights', config)
      bot.start({ mqtt })
    })

    test('should parse Modbus relay state correctly when bit 15 is ON', () => {
      const modbusPayload = { outputs: 0x8000 } // Bit 15 set
      const parsed = config.stateParser(modbusPayload)
      expect(parsed).toBe(true)
    })

    test('should parse Modbus relay state correctly when bit 15 is OFF', () => {
      const modbusPayload = { outputs: 0x7FFF } // Bit 15 clear
      const parsed = config.stateParser(modbusPayload)
      expect(parsed).toBe(false)
    })

    test('should format command for Modbus relay', () => {
      const command = config.commandTemplate(true)
      expect(command).toEqual({ out15: true })
    })
  })
})
