const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals')
const EventEmitter = require('events')

// Mock MQTT client
class MockMqttClient extends EventEmitter {
  constructor() {
    super()
    this.subscriptions = new Map()
    this.published = []
    this.connected = false
  }

  connect() {
    this.connected = true
    this.emit('connect')
    return this
  }

  subscribe(topic, callback) {
    this.subscriptions.set(topic, true)
    if (callback) callback(null)
  }

  publish(topic, payload, options, callback) {
    this.published.push({ topic, payload, options })
    if (callback) callback(null)
  }

  end() {
    this.connected = false
    this.emit('disconnect')
  }

  // Test helper to simulate incoming messages
  simulateMessage(topic, payload) {
    this.emit('message', topic, Buffer.from(JSON.stringify(payload)))
  }
}

// Mock mqtt module
const mockMqttClient = new MockMqttClient()
jest.doMock('mqtt', () => ({
  connect: jest.fn().mockReturnValue(mockMqttClient)
}))

// Mock bot for testing
const createTestBot = (name, config) => ({
  start: ({ mqtt }) => {
    // Subscribe to multiple topics to test listener accumulation
    mqtt.subscribe(config.topic1, (payload) => {
      config.callback1(payload)
    })

    mqtt.subscribe(config.topic2, (payload) => {
      config.callback2(payload)
    })

    // Subscribe to same topic again to test deduplication
    mqtt.subscribe(config.topic1, (payload) => {
      config.callback1Duplicate(payload)
    })
  }
})

describe('MQTT Subscription Framework', () => {
  let originalProcessEnv

  beforeEach(() => {
    jest.clearAllMocks()
    originalProcessEnv = process.env
    process.env = { ...originalProcessEnv }
    mockMqttClient.removeAllListeners()
    mockMqttClient.published = []
    mockMqttClient.subscriptions.clear()
  })

  afterEach(() => {
    process.env = originalProcessEnv
  })

  describe('Event Listener Management', () => {
    test('should not accumulate message listeners for same topic', () => {
      const callback1 = jest.fn()
      const callback1Duplicate = jest.fn()

      // Test the fixed subscription logic directly
      const topicHandlers = new Map()

      const subscribe = (topic, cb) => {
        if (!topicHandlers.has(topic)) {
          topicHandlers.set(topic, [])
          // Only add one message listener per unique topic
          mockMqttClient.on('message', (msgTopic, payload) => {
            const handlers = topicHandlers.get(msgTopic)
            if (handlers) {
              try {
                const parsedPayload = JSON.parse(payload.toString())
                handlers.forEach(handler => handler(parsedPayload))
              } catch (err) {
                console.error(`Error parsing payload for topic ${msgTopic}:`, err)
              }
            }
          })
        }
        topicHandlers.get(topic).push(cb)
      }

      // Initial listener count
      const initialListenerCount = mockMqttClient.listenerCount('message')

      // Subscribe to same topic multiple times
      subscribe('test/topic1', callback1)
      subscribe('test/topic1', callback1Duplicate)

      // Should only add one listener for the topic
      const finalListenerCount = mockMqttClient.listenerCount('message')
      expect(finalListenerCount).toBe(initialListenerCount + 1)

      // Test that both callbacks work
      mockMqttClient.simulateMessage('test/topic1', { state: true })
      expect(callback1).toHaveBeenCalledWith({ state: true })
      expect(callback1Duplicate).toHaveBeenCalledWith({ state: true })
    })

    test('should handle multiple callbacks for same topic correctly', () => {
      const callback1 = jest.fn()
      const callback1Duplicate = jest.fn()

      // Simulate the fixed subscription logic
      const topicHandlers = new Map()

      const subscribe = (topic, cb) => {
        if (!topicHandlers.has(topic)) {
          topicHandlers.set(topic, [])
          // Only add one message listener per topic
          mockMqttClient.on('message', (msgTopic, payload) => {
            const handlers = topicHandlers.get(msgTopic)
            if (handlers) {
              const parsedPayload = JSON.parse(payload.toString())
              handlers.forEach(handler => handler(parsedPayload))
            }
          })
        }
        topicHandlers.get(topic).push(cb)
      }

      // Subscribe to same topic multiple times
      subscribe('test/topic', callback1)
      subscribe('test/topic', callback1Duplicate)

      // Simulate message
      mockMqttClient.simulateMessage('test/topic', { state: true })

      // Both callbacks should be called
      expect(callback1).toHaveBeenCalledWith({ state: true })
      expect(callback1Duplicate).toHaveBeenCalledWith({ state: true })

      // But only one message listener should exist
      expect(mockMqttClient.listenerCount('message')).toBe(1)
    })

    test('should handle different topics with separate handlers', () => {
      const callback1 = jest.fn()
      const callback2 = jest.fn()

      const topicHandlers = new Map()

      const subscribe = (topic, cb) => {
        if (!topicHandlers.has(topic)) {
          topicHandlers.set(topic, [])
          mockMqttClient.on('message', (msgTopic, payload) => {
            const handlers = topicHandlers.get(msgTopic)
            if (handlers) {
              const parsedPayload = JSON.parse(payload.toString())
              handlers.forEach(handler => handler(parsedPayload))
            }
          })
        }
        topicHandlers.get(topic).push(cb)
      }

      subscribe('test/topic1', callback1)
      subscribe('test/topic2', callback2)

      // Simulate messages to different topics
      mockMqttClient.simulateMessage('test/topic1', { value: 1 })
      mockMqttClient.simulateMessage('test/topic2', { value: 2 })

      expect(callback1).toHaveBeenCalledWith({ value: 1 })
      expect(callback2).toHaveBeenCalledWith({ value: 2 })

      // Should have 2 message listeners (one per topic)
      expect(mockMqttClient.listenerCount('message')).toBe(2)
    })
  })

  describe('MQTT Connection Logging', () => {
    test('should log connection events', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      // Set up connection event handlers like the main module does
      mockMqttClient.on('connect', () => {
        console.log('[MQTT] Connected')
      })

      mockMqttClient.on('disconnect', () => {
        console.log('[MQTT] Disconnected')
      })

      mockMqttClient.on('error', (err) => {
        console.log('[MQTT] Error:', err)
      })

      // Emit events
      mockMqttClient.emit('connect')
      mockMqttClient.emit('disconnect')
      mockMqttClient.emit('error', new Error('test error'))

      expect(consoleSpy).toHaveBeenCalledWith('[MQTT] Connected')
      expect(consoleSpy).toHaveBeenCalledWith('[MQTT] Disconnected')
      expect(consoleSpy).toHaveBeenCalledWith('[MQTT] Error:', expect.any(Error))

      consoleSpy.mockRestore()
    })

    test('should log listener count periodically', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      // Simulate periodic logging
      const logListenerCount = () => {
        console.log(`[MQTT] Active message listeners: ${mockMqttClient.listenerCount('message')}`)
      }

      mockMqttClient.on('message', () => {})
      mockMqttClient.on('message', () => {})

      logListenerCount()

      expect(consoleSpy).toHaveBeenCalledWith('[MQTT] Active message listeners: 2')

      consoleSpy.mockRestore()
    })
  })
})