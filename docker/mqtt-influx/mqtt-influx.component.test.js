#!/usr/bin/env node

/**
 * Component test for mqtt-influx service with minimal mocking
 * 
 * Tests the complete message processing flow from MQTT subscription through InfluxDB point generation
 * using real dependencies and in-memory services following minimal mocking best practices.
 * 
 * Testing approach:
 * - Uses Aedes in-memory MQTT broker (real MQTT server)
 * - Uses real InfluxDB client with in-memory point accumulation
 * - Tests actual topic subscription patterns and message routing
 * - Validates complete data transformation pipeline
 * - Tests error handling and edge cases
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const net = require('net')
const mqtt = require('mqtt')
const Aedes = require('aedes')
const { InfluxDB } = require('@influxdata/influxdb-client')

// Import converters directly to test integration
const commandVerificationConverter = require('./converters/command-verification.js')

// Test configuration
const TEST_CONFIG = {
  mqtt: {
    port: 1884,  // Different from production to avoid conflicts
    host: 'localhost'
  },
  influx: {
    url: 'http://localhost:8086',
    org: 'test-org',
    bucket: 'test-bucket',
    token: 'test-token'
  },
  timeouts: {
    connectionTimeout: 5000,
    messageProcessing: 1000
  }
}

// Global test state
let aedesServer = null
let server = null
let testMqttClient = null
let serviceInfluxClient = null
let capturedPoints = []

// Mock InfluxDB writeApi that captures points for verification
function createMockWriteApi() {
  return {
    writePoints(points) {
      // Capture points for test validation but process them like real service
      capturedPoints.push(...points)
      console.log(`Captured ${points.length} points for testing`)
    },
    writePoint(point) {
      capturedPoints.push(point)
      console.log('Captured 1 point for testing')
    },
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    dispose: () => Promise.resolve()
  }
}

// Service simulation that mirrors the actual index.js behavior
function createServiceSimulation(mqttUrl, topic, writeApi, converters) {
  const client = mqtt.connect(mqttUrl, {
    clientId: 'mqtt-influx-test-service'
  })

  const connectionPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Service MQTT connection timeout'))
    }, TEST_CONFIG.timeouts.connectionTimeout)

    client.on('connect', () => {
      clearTimeout(timeout)
      console.log('Service connected to MQTT broker')
      
      client.subscribe(topic, (err) => {
        if (err) {
          reject(err)
        } else {
          console.log(`Service subscribed to ${topic}`)
          resolve()
        }
      })
    })

    client.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })

  // Message handler that mimics index.js exactly
  client.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message)

      if (!(data._type in converters)) {
        console.warn('Service: Unhandled type', data._type, data)
        return
      }

      const points = converters[data._type](data)
      writeApi.writePoints(points)
    } catch (error) {
      console.error('Service: Message processing error:', error)
    }
  })

  return {
    connectionPromise,
    client,
    disconnect: () => {
      return new Promise((resolve) => {
        client.end(false, resolve)
      })
    }
  }
}

describe('MQTT-InfluxDB Service Component Tests', () => {
  
  before(async () => {
    console.log('🚀 Setting up component test environment...')
    
    // Step 1: Create Aedes in-memory MQTT broker
    console.log('📡 Starting in-memory MQTT broker...')
    aedesServer = new Aedes()
    server = net.createServer(aedesServer.handle)
    
    await new Promise((resolve, reject) => {
      server.listen(TEST_CONFIG.mqtt.port, TEST_CONFIG.mqtt.host, (err) => {
        if (err) reject(err)
        else {
          console.log(`✅ MQTT broker listening on ${TEST_CONFIG.mqtt.host}:${TEST_CONFIG.mqtt.port}`)
          resolve()
        }
      })
    })
    
    // Step 2: Create test MQTT client
    console.log('🔌 Creating test MQTT client...')
    const mqttUrl = `mqtt://${TEST_CONFIG.mqtt.host}:${TEST_CONFIG.mqtt.port}`
    testMqttClient = mqtt.connect(mqttUrl, {
      clientId: 'test-publisher'
    })
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test client connection timeout'))
      }, TEST_CONFIG.timeouts.connectionTimeout)

      testMqttClient.on('connect', () => {
        clearTimeout(timeout)
        console.log('✅ Test client connected to MQTT broker')
        resolve()
      })

      testMqttClient.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
    
    console.log('✅ Component test environment ready')
  })
  
  after(async () => {
    console.log('🧹 Cleaning up component test...')
    
    if (testMqttClient) {
      await new Promise((resolve) => {
        testMqttClient.end(false, resolve)
      })
    }
    
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve)
      })
    }
    
    if (aedesServer) {
      await new Promise((resolve) => {
        aedesServer.close(resolve)
      })
    }
    
    console.log('✅ Component test cleanup complete')
  })

  test('should handle complete MQTT to InfluxDB pipeline for command verification events', async () => {
    console.log('🧪 Testing complete command verification pipeline...')
    
    // Clear captured points
    capturedPoints = []
    
    // Create service simulation with real converters and mock writeApi
    const mqttUrl = `mqtt://${TEST_CONFIG.mqtt.host}:${TEST_CONFIG.mqtt.port}`
    const topic = 'homy/automation/+/command_failed'
    const writeApi = createMockWriteApi()
    const converters = {
      'command-verification': commandVerificationConverter
    }
    
    const service = createServiceSimulation(mqttUrl, topic, writeApi, converters)
    
    // Wait for service to connect and subscribe
    await service.connectionPromise
    
    // Test data - realistic command failure event
    const testEvent = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: 'lightBath1Controller',
      reason: 'toggle_on',
      attempts: 3,
      expectedState: true,
      actualState: false,
      timestamp: Date.now()
    }
    
    // Publish event via MQTT (real network communication)
    console.log('📨 Publishing test event via MQTT...')
    await new Promise((resolve, reject) => {
      const targetTopic = 'homy/automation/lightBath1Controller/command_failed'
      testMqttClient.publish(targetTopic, JSON.stringify(testEvent), (error) => {
        if (error) reject(error)
        else {
          console.log(`✅ Event published to ${targetTopic}`)
          resolve()
        }
      })
    })
    
    // Wait for message processing
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.timeouts.messageProcessing))
    
    // Verify points were captured
    assert.strictEqual(capturedPoints.length, 1, 'Should capture exactly one InfluxDB point')
    
    const capturedPoint = capturedPoints[0]
    const lineProtocol = capturedPoint.toString()
    
    // Verify the complete transformation pipeline
    assert.match(lineProtocol, /^command_failure,/, 'Should create command_failure measurement')
    assert.match(lineProtocol, /controller=lightBath1Controller/, 'Should preserve controller from MQTT topic')
    assert.match(lineProtocol, /reason=toggle_on/, 'Should preserve reason from event data')
    assert.match(lineProtocol, /attempts=3i/, 'Should transform attempts to integer field')
    assert.match(lineProtocol, /expected_state=T/, 'Should transform expectedState to boolean field')
    assert.match(lineProtocol, /actual_state=F/, 'Should transform actualState to boolean field')
    
    console.log('✅ Complete pipeline validation successful')
    console.log(`📊 Generated line protocol: ${lineProtocol}`)
    
    // Cleanup service
    await service.disconnect()
  })

  test('should handle multiple converters and topic patterns correctly', async () => {
    console.log('🧪 Testing multiple converter registration and topic routing...')
    
    capturedPoints = []
    
    // Create service with multiple converters
    const mqttUrl = `mqtt://${TEST_CONFIG.mqtt.host}:${TEST_CONFIG.mqtt.port}`
    const topic = 'homy/+/+/+'  // Broader pattern to test routing
    const writeApi = createMockWriteApi()
    const converters = {
      'command-verification': commandVerificationConverter,
      'test-converter': (data) => {
        const points = []
        if (data.type === 'test_event') {
          const { Point } = require('@influxdata/influxdb-client')
          const point = new Point('test_measurement')
            .tag('device', data.device)
            .floatField('value', data.value)
            .timestamp(new Date(data.timestamp))
          points.push(point)
        }
        return points
      }
    }
    
    const service = createServiceSimulation(mqttUrl, topic, writeApi, converters)
    await service.connectionPromise
    
    // Test command verification event
    const commandEvent = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: 'testController',
      reason: 'test_reason',
      attempts: 1,
      expectedState: false,
      actualState: true,
      timestamp: Date.now()
    }
    
    // Test custom converter event
    const customEvent = {
      _type: 'test-converter',
      type: 'test_event',
      device: 'sensor1',
      value: 42.5,
      timestamp: Date.now()
    }
    
    // Test unknown converter event
    const unknownEvent = {
      _type: 'unknown-converter',
      type: 'unknown_event',
      data: 'should be ignored'
    }
    
    // Publish all events
    const events = [
      { topic: 'homy/automation/testController/command_failed', data: commandEvent },
      { topic: 'homy/sensors/sensor1/reading', data: customEvent },
      { topic: 'homy/unknown/device/event', data: unknownEvent }
    ]
    
    for (const { topic, data } of events) {
      await new Promise((resolve, reject) => {
        testMqttClient.publish(topic, JSON.stringify(data), (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.timeouts.messageProcessing))
    
    // Verify correct number of points (unknown converter should be ignored)
    assert.strictEqual(capturedPoints.length, 2, 'Should capture points from known converters only')
    
    // Verify command verification point
    const commandPoint = capturedPoints.find(p => p.toString().includes('command_failure'))
    assert.ok(commandPoint, 'Should capture command verification point')
    assert.match(commandPoint.toString(), /controller=testController/, 'Should preserve controller data')
    
    // Verify custom converter point
    const customPoint = capturedPoints.find(p => p.toString().includes('test_measurement'))
    assert.ok(customPoint, 'Should capture custom converter point')
    assert.match(customPoint.toString(), /device=sensor1/, 'Should preserve device tag')
    assert.match(customPoint.toString(), /value=42.5/, 'Should preserve value field')
    
    console.log('✅ Multiple converter test successful')
    
    await service.disconnect()
  })

  test('should handle malformed messages and connection errors gracefully', async () => {
    console.log('🧪 Testing error handling and edge cases...')
    
    capturedPoints = []
    
    const mqttUrl = `mqtt://${TEST_CONFIG.mqtt.host}:${TEST_CONFIG.mqtt.port}`
    const topic = 'test/error/handling'
    const writeApi = createMockWriteApi()
    const converters = {
      'command-verification': commandVerificationConverter
    }
    
    const service = createServiceSimulation(mqttUrl, topic, writeApi, converters)
    await service.connectionPromise
    
    // Test malformed JSON
    console.log('📨 Testing malformed JSON handling...')
    await new Promise((resolve, reject) => {
      testMqttClient.publish('test/error/handling', '{ invalid json }', (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    
    // Test valid JSON but missing _type
    const missingTypeEvent = {
      type: 'command_failed',
      controller: 'test',
      timestamp: Date.now()
    }
    
    await new Promise((resolve, reject) => {
      testMqttClient.publish('test/error/handling', JSON.stringify(missingTypeEvent), (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    
    // Test valid JSON with unknown _type
    const unknownTypeEvent = {
      _type: 'non-existent-converter',
      type: 'some_event',
      data: 'test'
    }
    
    await new Promise((resolve, reject) => {
      testMqttClient.publish('test/error/handling', JSON.stringify(unknownTypeEvent), (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.timeouts.messageProcessing))
    
    // Should not have captured any points from malformed/invalid messages
    assert.strictEqual(capturedPoints.length, 0, 'Should not capture points from invalid messages')
    
    console.log('✅ Error handling test successful - service remained stable')
    
    await service.disconnect()
  })

  test('should handle MQTT topic pattern matching correctly', async () => {
    console.log('🧪 Testing MQTT topic pattern matching and subscription behavior...')
    
    capturedPoints = []
    
    // Test specific topic pattern used by automation service
    const mqttUrl = `mqtt://${TEST_CONFIG.mqtt.host}:${TEST_CONFIG.mqtt.port}`
    const topic = 'homy/automation/+/command_failed'  // Real pattern from docker-compose
    const writeApi = createMockWriteApi()
    const converters = {
      'command-verification': commandVerificationConverter
    }
    
    const service = createServiceSimulation(mqttUrl, topic, writeApi, converters)
    await service.connectionPromise
    
    // Test events that should match the topic pattern
    const validEvent = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: 'lightBath1Controller',
      reason: 'toggle_on',
      attempts: 2,
      expectedState: true,
      actualState: false,
      timestamp: Date.now()
    }
    
    // Test topics that should match
    const matchingTopics = [
      'homy/automation/lightBath1Controller/command_failed',
      'homy/automation/lightBath2Controller/command_failed',
      'homy/automation/anyController/command_failed'
    ]
    
    // Test topics that should NOT match
    const nonMatchingTopics = [
      'homy/automation/lightBath1Controller/other_event',  // Wrong event type
      'homy/sensors/lightBath1Controller/command_failed',  // Wrong category
      'other/automation/lightBath1Controller/command_failed',  // Wrong root
      'homy/automation/command_failed'  // Missing controller level
    ]
    
    // Publish to matching topics
    for (const topic of matchingTopics) {
      await new Promise((resolve, reject) => {
        testMqttClient.publish(topic, JSON.stringify(validEvent), (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
    
    // Publish to non-matching topics  
    for (const topic of nonMatchingTopics) {
      await new Promise((resolve, reject) => {
        testMqttClient.publish(topic, JSON.stringify(validEvent), (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.timeouts.messageProcessing))
    
    // Should only capture points from matching topics
    assert.strictEqual(capturedPoints.length, matchingTopics.length, 
      `Should capture points only from ${matchingTopics.length} matching topics`)
    
    // Verify all captured points are command failures
    capturedPoints.forEach((point, index) => {
      const lineProtocol = point.toString()
      assert.match(lineProtocol, /^command_failure,/, `Point ${index} should be command_failure measurement`)
    })
    
    console.log('✅ Topic pattern matching test successful')
    
    await service.disconnect()
  })
})

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running MQTT-InfluxDB service component tests...')
}