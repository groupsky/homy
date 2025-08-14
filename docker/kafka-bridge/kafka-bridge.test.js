jest.mock('mqtt')
jest.mock('kafka-node')

const KafkaBridge = require('./kafka-bridge')
const mqtt = require('mqtt')
const kafka = require('kafka-node')

describe('KafkaBridge', () => {
  let bridge
  let mockMqttClient
  let mockKafkaProducer
  let mockKafkaClient

  beforeEach(() => {
    mockMqttClient = {
      on: jest.fn(),
      subscribe: jest.fn()
    }
    
    mockKafkaProducer = {
      ready: jest.fn(),
      send: jest.fn(),
      on: jest.fn()
    }

    mockKafkaClient = {}

    mqtt.connect.mockReturnValue(mockMqttClient)
    kafka.KafkaClient.mockReturnValue(mockKafkaClient)
    kafka.Producer.mockReturnValue(mockKafkaProducer)

    bridge = new KafkaBridge({
      mqttUrl: 'mqtt://test-broker',
      kafkaHosts: ['kafka:9092'],
      clientId: 'test-bridge'
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    test('should initialize with correct configuration', () => {
      expect(bridge.config).toEqual({
        mqttUrl: 'mqtt://test-broker',
        kafkaHosts: ['kafka:9092'],
        clientId: 'test-bridge'
      })
    })
  })

  describe('start', () => {
    test('should connect to MQTT and Kafka', async () => {
      mockMqttClient.on.mockImplementation((event, callback) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0)
        }
      })
      
      mockKafkaProducer.on.mockImplementation((event, callback) => {
        if (event === 'ready') {
          setTimeout(() => callback(), 0)
        }
      })

      await bridge.start()

      expect(mqtt.connect).toHaveBeenCalledWith('mqtt://test-broker', {
        clientId: 'test-bridge'
      })
      expect(mockMqttClient.subscribe).toHaveBeenCalledWith('homy/features/+/+/status')
      expect(mockMqttClient.subscribe).toHaveBeenCalledWith('homy/automation/+/state')
      expect(kafka.Producer).toHaveBeenCalledWith(mockKafkaClient)
    })
  })

  describe('bridgeMessage', () => {
    test('should transform MQTT message to Kafka event', async () => {
      bridge.kafkaProducer = mockKafkaProducer
      mockKafkaProducer.send.mockImplementation((payloads, callback) => {
        callback(null, [{ partition: 0, offset: 123 }])
      })

      const topic = 'homy/features/light/bath1/status'
      const payload = { state: 'on', brightness: 80 }
      const message = JSON.stringify(payload)

      await bridge.bridgeMessage(topic, Buffer.from(message))

      expect(mockKafkaProducer.send).toHaveBeenCalledTimes(1)
      const callArgs = mockKafkaProducer.send.mock.calls[0]
      const kafkaPayload = callArgs[0][0]
      const event = JSON.parse(kafkaPayload.messages[0].value)
      
      expect(kafkaPayload.topic).toBe('homy.events')
      expect(kafkaPayload.messages[0].key).toBe('homy.features.light.bath1.status')
      expect(event.eventType).toBe('feature.state.changed')
      expect(event.aggregateId).toBe('light.bath1')
      expect(event.timestamp).toEqual(expect.any(Number))
      expect(event.data).toEqual({ state: 'on', brightness: 80 })
      expect(event.metadata).toEqual({
        source: 'mqtt',
        originalTopic: 'homy/features/light/bath1/status'
      })
    })

    test('should handle automation bot events', async () => {
      bridge.kafkaProducer = mockKafkaProducer
      mockKafkaProducer.send.mockImplementation((payloads, callback) => {
        callback(null, [{ partition: 0, offset: 124 }])
      })

      const topic = 'homy/automation/bath-lights/state'
      const payload = { 
        occupancyDetected: true, 
        timeout: 300,
        _bot: { name: 'bath1-controller', type: 'bath-lights' }
      }
      const message = JSON.stringify(payload)

      await bridge.bridgeMessage(topic, Buffer.from(message))

      expect(mockKafkaProducer.send).toHaveBeenCalledTimes(1)
      const callArgs = mockKafkaProducer.send.mock.calls[0]
      const kafkaPayload = callArgs[0][0]
      const event = JSON.parse(kafkaPayload.messages[0].value)
      
      expect(kafkaPayload.topic).toBe('homy.events')
      expect(kafkaPayload.messages[0].key).toBe('homy.automation.bath-lights.state')
      expect(event.eventType).toBe('automation.state.changed')
      expect(event.aggregateId).toBe('bath-lights.bath1-controller')
      expect(event.timestamp).toEqual(expect.any(Number))
      expect(event.data).toEqual({
        occupancyDetected: true,
        timeout: 300
      })
      expect(event.metadata).toEqual({
        source: 'mqtt',
        originalTopic: 'homy/automation/bath-lights/state',
        bot: { name: 'bath1-controller', type: 'bath-lights' }
      })
    })

    test('should skip messages that don\'t match event patterns', async () => {
      bridge.kafkaProducer = mockKafkaProducer

      const topic = '/modbus/main/meter1/reading'
      const payload = { power: 1500 }
      const message = JSON.stringify(payload)

      await bridge.bridgeMessage(topic, Buffer.from(message))

      expect(mockKafkaProducer.send).not.toHaveBeenCalled()
    })
  })

  describe('transformToEvent', () => {
    test('should transform feature state change', () => {
      const topic = 'homy/features/light/bath1/status'
      const payload = { state: 'on' }

      const event = bridge.transformToEvent(topic, payload)

      expect(event).toEqual({
        eventType: 'feature.state.changed',
        aggregateId: 'light.bath1',
        timestamp: expect.any(Number),
        data: { state: 'on' },
        metadata: {
          source: 'mqtt',
          originalTopic: topic
        }
      })
    })

    test('should transform automation state change', () => {
      const topic = 'homy/automation/bath-lights/state'
      const payload = { 
        occupancyDetected: true,
        _bot: { name: 'bath1-controller', type: 'bath-lights' }
      }

      const event = bridge.transformToEvent(topic, payload)

      expect(event).toEqual({
        eventType: 'automation.state.changed',
        aggregateId: 'bath-lights.bath1-controller',
        timestamp: expect.any(Number),
        data: { occupancyDetected: true },
        metadata: {
          source: 'mqtt',
          originalTopic: topic,
          bot: { name: 'bath1-controller', type: 'bath-lights' }
        }
      })
    })
  })
})