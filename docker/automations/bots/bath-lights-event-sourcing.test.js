const {beforeEach, describe, jest, test, expect} = require('@jest/globals')

// Mock kafka-node for testing
jest.mock('kafka-node')
const kafka = require('kafka-node')

// Mock the event sourcing module
const EventSourcingBathLights = require('./bath-lights-event-sourcing')

describe('bath-lights-event-sourcing', () => {
  let mockKafkaConsumer
  let mockKafkaProducer
  let mockMqttPublish
  let mockMqttSubscribe
  
  const mqttSubscriptions = {}

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    mockKafkaConsumer = {
      on: jest.fn(),
      close: jest.fn(),
      addTopics: jest.fn()
    }

    mockKafkaProducer = {
      on: jest.fn(),
      send: jest.fn((payloads, callback) => callback(null, 'success')),
      ready: jest.fn().mockResolvedValue()
    }

    kafka.Consumer.mockReturnValue(mockKafkaConsumer)
    kafka.Producer.mockReturnValue(mockKafkaProducer)
    kafka.KafkaClient.mockReturnValue({})

    mockMqttPublish = jest.fn()
    mockMqttSubscribe = jest.fn((topic, cb) => {
      mqttSubscriptions[topic] = cb
    })

    // Clear subscriptions
    Object.keys(mqttSubscriptions).forEach(key => delete mqttSubscriptions[key])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const publishToMqtt = (topic, payload) => {
    if (mqttSubscriptions[topic]) {
      mqttSubscriptions[topic](payload)
    }
  }

  describe('event sourcing integration', () => {
    test('should persist state changes to Kafka', async () => {
      const bathLights = EventSourcingBathLights('test-bath', {
        light: { statusTopic: 'lights/status', commandTopic: 'lights/command' },
        door: { statusTopic: 'door/status' },
        kafka: {
          hosts: ['kafka:9092'],
          eventsTopicPrefix: 'homy.events'
        }
      })

      const mqtt = { subscribe: mockMqttSubscribe, publish: mockMqttPublish }
      await bathLights.start({ mqtt })

      // Simulate door opening
      publishToMqtt('door/status', { state: true })

      // Should publish event to Kafka
      expect(mockKafkaProducer.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            topic: 'homy.events.test-bath',
            messages: expect.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('door.state.changed')
              })
            ])
          })
        ]),
        expect.any(Function)
      )
    })

    test('should persist automation decisions to event store', async () => {
      const bathLights = EventSourcingBathLights('test-bath', {
        light: { statusTopic: 'lights/status', commandTopic: 'lights/command' },
        door: { statusTopic: 'door/status' },
        kafka: {
          hosts: ['kafka:9092'],
          eventsTopicPrefix: 'homy.events'
        }
      })

      const mqtt = { subscribe: mockMqttSubscribe, publish: mockMqttPublish }
      await bathLights.start({ mqtt })

      // Simulate door opening which should turn on lights
      publishToMqtt('door/status', { state: true })

      // Should publish automation decision event
      expect(mockKafkaProducer.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            topic: 'homy.events.test-bath',
            messages: expect.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('automation.decision.made')
              })
            ])
          })
        ]),
        expect.any(Function)
      )

      // Should also send MQTT command
      expect(mockMqttPublish).toHaveBeenCalledWith(
        'lights/command', 
        expect.objectContaining({ state: true })
      )
    })

    test('should restore state from event stream on startup', async () => {
      // Mock Kafka consumer to provide historical events
      const historicalEvents = [
        {
          value: JSON.stringify({
            eventType: 'door.state.changed',
            timestamp: Date.now() - 5000,
            data: { state: false },
            aggregateId: 'test-bath'
          })
        },
        {
          value: JSON.stringify({
            eventType: 'light.state.changed',
            timestamp: Date.now() - 3000,
            data: { state: true },
            aggregateId: 'test-bath'
          })
        }
      ]

      mockKafkaConsumer.on.mockImplementation((event, callback) => {
        if (event === 'message') {
          // Simulate receiving historical events
          setTimeout(() => {
            historicalEvents.forEach(event => callback(event))
          }, 100)
        }
      })

      const bathLights = EventSourcingBathLights('test-bath', {
        light: { statusTopic: 'lights/status', commandTopic: 'lights/command' },
        door: { statusTopic: 'door/status' },
        kafka: {
          hosts: ['kafka:9092'],
          eventsTopicPrefix: 'homy.events'
        }
      })

      const mqtt = { subscribe: mockMqttSubscribe, publish: mockMqttPublish }
      await bathLights.start({ mqtt })

      // Advance timers to allow event processing
      jest.advanceTimersByTime(200)

      // State should be restored from events
      const currentState = bathLights.getCurrentState()
      expect(currentState).toEqual({
        door: false,
        light: true,
        lock: null,
        toggle: null
      })
    })

    test('should replay events to debug automation behavior', async () => {
      const replayEvents = [
        {
          eventType: 'door.state.changed',
          timestamp: Date.now() - 10000,
          data: { state: true },
          aggregateId: 'test-bath'
        },
        {
          eventType: 'automation.decision.made',
          timestamp: Date.now() - 9500,
          data: { 
            action: 'turn_on_lights',
            reason: 'door_opened',
            lightState: false
          },
          aggregateId: 'test-bath'
        },
        {
          eventType: 'light.state.changed',
          timestamp: Date.now() - 9000,
          data: { state: true },
          aggregateId: 'test-bath'
        }
      ]

      const bathLights = EventSourcingBathLights('test-bath', {
        light: { statusTopic: 'lights/status', commandTopic: 'lights/command' },
        door: { statusTopic: 'door/status' },
        kafka: {
          hosts: ['kafka:9092'],
          eventsTopicPrefix: 'homy.events'
        }
      })

      const mqtt = { subscribe: mockMqttSubscribe, publish: mockMqttPublish }
      await bathLights.start({ mqtt })

      // Replay events
      const replayResult = await bathLights.replayEvents(replayEvents)

      expect(replayResult).toEqual({
        finalState: {
          door: true,
          light: true,
          lock: null,
          toggle: null
        },
        decisions: [
          {
            timestamp: expect.any(Number),
            action: 'turn_on_lights',
            reason: 'door_opened',
            inputState: { door: false, light: false, lock: null, toggle: null },
            outputState: { door: true, light: false, lock: null, toggle: null }
          }
        ]
      })
    })

    test('should handle timeout events in event sourcing mode', async () => {
      const bathLights = EventSourcingBathLights('test-bath', {
        light: { statusTopic: 'lights/status', commandTopic: 'lights/command' },
        door: { statusTopic: 'door/status' },
        timeouts: { opened: 1000 },
        kafka: {
          hosts: ['kafka:9092'],
          eventsTopicPrefix: 'homy.events'
        }
      })

      const mqtt = { subscribe: mockMqttSubscribe, publish: mockMqttPublish }
      await bathLights.start({ mqtt })

      // Door opens, lights should turn on
      publishToMqtt('door/status', { state: true })

      // Clear previous calls
      mockKafkaProducer.send.mockClear()

      // Advance time to trigger timeout
      jest.advanceTimersByTime(1000)

      // Should publish timeout event to Kafka
      expect(mockKafkaProducer.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            topic: 'homy.events.test-bath',
            messages: expect.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('timeout.triggered')
              })
            ])
          })
        ]),
        expect.any(Function)
      )
    })

    test('should persist timer creation and cancellation events', async () => {
      const bathLights = EventSourcingBathLights('test-bath', {
        light: { statusTopic: 'lights/status', commandTopic: 'lights/command' },
        door: { statusTopic: 'door/status' },
        lock: { statusTopic: 'lock/status' },
        timeouts: { opened: 1000 },
        kafka: {
          hosts: ['kafka:9092'],
          eventsTopicPrefix: 'homy.events'
        }
      })

      const mqtt = { subscribe: mockMqttSubscribe, publish: mockMqttPublish }
      await bathLights.start({ mqtt })

      // Clear initial setup calls
      mockKafkaProducer.send.mockClear()

      // Door opens - should create timer
      publishToMqtt('door/status', { state: true })

      // Should publish timer creation event
      expect(mockKafkaProducer.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            topic: 'homy.events.test-bath',
            messages: expect.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('timer.created')
              })
            ])
          })
        ]),
        expect.any(Function)
      )

      mockKafkaProducer.send.mockClear()

      // Lock door - should cancel timer
      publishToMqtt('lock/status', { state: true })

      // Should publish timer cancellation event
      expect(mockKafkaProducer.send).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            topic: 'homy.events.test-bath',
            messages: expect.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('timer.cancelled')
              })
            ])
          })
        ]),
        expect.any(Function)
      )
    })
  })
})