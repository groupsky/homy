/**
 * Tests for dmx-driver service
 * Validates DMX device control via MQTT messages
 */

const TEST_CONSTANTS = require('./test-constants')

// Mock dependencies before requiring the module
jest.mock('dmx', () => {
  const mockDMX = {
    set: jest.fn(),
    setHz: jest.fn(),
    step: jest.fn()
  }

  return {
    DMX: jest.fn(() => mockDMX)
  }
})

jest.mock('mqtt', () => ({
  connect: jest.fn()
}))

describe('dmx-driver', () => {
  let mockDMXInstance
  let mockMQTTClient
  let originalEnv

  beforeEach(() => {
    jest.clearAllMocks()

    // Save original environment
    originalEnv = { ...process.env }

    // Set test environment variables
    process.env.BROKER = TEST_CONSTANTS.MQTT.BROKER_URL
    process.env.TOPIC = TEST_CONSTANTS.MQTT.TOPIC
    process.env.MQTT_CLIENT_ID = TEST_CONSTANTS.MQTT.CLIENT_ID
    process.env.DMX_DEVICE = TEST_CONSTANTS.DMX.DEVICE_ID.toString()

    // Setup MQTT mock
    mockMQTTClient = {
      on: jest.fn(),
      subscribe: jest.fn((topic, callback) => callback(null))
    }

    const mqtt = require('mqtt')
    mqtt.connect.mockReturnValue(mockMQTTClient)

    // Setup DMX mock
    const { DMX } = require('dmx')
    mockDMXInstance = DMX.mock.results[0]?.value || {
      set: jest.fn(),
      setHz: jest.fn(),
      step: jest.fn()
    }
    DMX.mockReturnValue(mockDMXInstance)
  })

  afterEach(() => {
    // Restore environment
    process.env = originalEnv
    jest.resetModules()
  })

  describe('Initialization', () => {
    test('should connect to MQTT broker with correct parameters', () => {
      require('./index')

      const mqtt = require('mqtt')
      expect(mqtt.connect).toHaveBeenCalledWith(
        TEST_CONSTANTS.MQTT.BROKER_URL,
        { clientId: TEST_CONSTANTS.MQTT.CLIENT_ID }
      )
    })

    test('should initialize DMX device with device ID from environment', () => {
      require('./index')

      const { DMX } = require('dmx')
      expect(DMX).toHaveBeenCalledWith(TEST_CONSTANTS.DMX.DEVICE_ID)
    })

    test('should use default device ID 0 when DMX_DEVICE not set', () => {
      delete process.env.DMX_DEVICE

      require('./index')

      const { DMX } = require('dmx')
      expect(DMX).toHaveBeenCalledWith(0)
    })

    test('should configure DMX update rate to 20Hz', () => {
      require('./index')

      expect(mockDMXInstance.setHz).toHaveBeenCalledWith(20)
    })

    test('should configure DMX step to 5', () => {
      require('./index')

      expect(mockDMXInstance.step).toHaveBeenCalledWith(5)
    })

    test('should initialize DMX with zero values', () => {
      require('./index')

      expect(mockDMXInstance.set).toHaveBeenCalledWith(0)
    })
  })

  describe('MQTT Connection Handling', () => {
    test('should subscribe to topic on connect', () => {
      require('./index')

      const connectHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )[1]

      connectHandler()

      expect(mockMQTTClient.subscribe).toHaveBeenCalledWith(
        TEST_CONSTANTS.MQTT.TOPIC,
        expect.any(Function)
      )
    })

    test('should exit process on subscription error', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation()

      mockMQTTClient.subscribe.mockImplementation((topic, callback) => {
        callback(new Error('Subscription failed'))
      })

      require('./index')

      const connectHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'connect'
      )[1]

      connectHandler()

      expect(mockExit).toHaveBeenCalledWith(1)
      mockExit.mockRestore()
    })

    test('should exit process on MQTT close', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation()

      require('./index')

      const closeHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'close'
      )[1]

      closeHandler()

      expect(mockExit).toHaveBeenCalledWith(1)
      mockExit.mockRestore()
    })

    test('should exit process on MQTT disconnect', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation()

      require('./index')

      const disconnectHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )[1]

      disconnectHandler()

      expect(mockExit).toHaveBeenCalledWith(1)
      mockExit.mockRestore()
    })

    test('should exit process on MQTT error', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation()

      require('./index')

      const errorHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'error'
      )[1]

      errorHandler(new Error('Connection error'))

      expect(mockExit).toHaveBeenCalledWith(1)
      mockExit.mockRestore()
    })

    test('should exit process on MQTT offline', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation()

      require('./index')

      const offlineHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'offline'
      )[1]

      offlineHandler()

      expect(mockExit).toHaveBeenCalledWith(1)
      mockExit.mockRestore()
    })
  })

  describe('DMX Channel Control', () => {
    test('should map bit 5 (32) to channel 1', () => {
      require('./index')

      const messageHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'message'
      )[1]

      messageHandler(TEST_CONSTANTS.MQTT.TOPIC, JSON.stringify({ inputs: 32 }))

      expect(mockDMXInstance.set).toHaveBeenCalledWith([128, 0, 0])
    })

    test('should map bit 9 (512) to channel 2', () => {
      require('./index')

      const messageHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'message'
      )[1]

      messageHandler(TEST_CONSTANTS.MQTT.TOPIC, JSON.stringify({ inputs: 512 }))

      expect(mockDMXInstance.set).toHaveBeenCalledWith([0, 128, 0])
    })

    test('should map bit 11 (2048) to channel 3', () => {
      require('./index')

      const messageHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'message'
      )[1]

      messageHandler(TEST_CONSTANTS.MQTT.TOPIC, JSON.stringify({ inputs: 2048 }))

      expect(mockDMXInstance.set).toHaveBeenCalledWith([0, 0, 128])
    })

    test('should handle multiple bits set simultaneously', () => {
      require('./index')

      const messageHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'message'
      )[1]

      // All three control bits set: 32 + 512 + 2048 = 2592
      messageHandler(TEST_CONSTANTS.MQTT.TOPIC, JSON.stringify({ inputs: 2592 }))

      expect(mockDMXInstance.set).toHaveBeenCalledWith([128, 128, 128])
    })

    test('should set channels to 0 when control bits are not set', () => {
      require('./index')

      const messageHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'message'
      )[1]

      messageHandler(TEST_CONSTANTS.MQTT.TOPIC, JSON.stringify(TEST_CONSTANTS.TEST_MESSAGES.ZERO_INPUT))

      expect(mockDMXInstance.set).toHaveBeenCalledWith([0, 0, 0])
    })

    test('should ignore other input bits', () => {
      require('./index')

      const messageHandler = mockMQTTClient.on.mock.calls.find(
        call => call[0] === 'message'
      )[1]

      // Set only non-control bits (all except 5, 9, 11)
      const nonControlBits = 4095 - 32 - 512 - 2048 // = 1523
      messageHandler(TEST_CONSTANTS.MQTT.TOPIC, JSON.stringify({ inputs: nonControlBits }))

      expect(mockDMXInstance.set).toHaveBeenCalledWith([0, 0, 0])
    })
  })
})
