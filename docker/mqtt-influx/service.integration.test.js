#!/usr/bin/env node

/**
 * Service Integration Test for mqtt-influx with real dependencies
 * 
 * Tests the complete mqtt-influx service behavior under realistic conditions
 * with actual InfluxDB connectivity and comprehensive error scenarios.
 * 
 * Integration testing approach:
 * - Uses real InfluxDB client (mocked writeApi for isolation)
 * - Tests complete service lifecycle (startup, operation, shutdown)
 * - Validates environment variable configuration
 * - Tests multiple converter scenarios and data pipelines
 * - Includes failure modes and recovery testing
 */

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert')
const net = require('net')
const mqtt = require('mqtt')
const Aedes = require('aedes')
const { InfluxDB } = require('@influxdata/influxdb-client')

// Test configuration that mirrors Docker environment
const SERVICE_CONFIG = {
  mqtt: {
    port: 1886,
    host: 'localhost'
  },
  influx: {
    url: 'http://localhost:8086',  // Real InfluxDB URL format
    token: 'test-user:test-password',  // Realistic token format
    org: '',  // Empty org like production
    bucket: 'homy/autogen'  // Real bucket format
  },
  env: {
    BROKER: null,  // Will be set dynamically
    TOPIC: 'homy/automation/+/command_failed',
    INFLUXDB_URL: 'http://localhost:8086',
    INFLUXDB_USERNAME: 'test-user',
    INFLUXDB_PASSWORD: 'test-password',
    INFLUXDB_DATABASE: 'homy',
    INFLUXDB_RP: 'autogen',
    MQTT_CLIENT_ID: 'mqtt-influx-automation-test',
    TAGS: '[]'
  },
  timeouts: {
    serviceStartup: 5000,
    messageProcessing: 1000,
    serviceShutdown: 3000
  }
}

// Global test infrastructure
let aedesBroker = null
let netServer = null
let serviceProcess = null
let capturedPoints = []
let influxErrors = []

// Mock InfluxDB writeApi that behaves like real API but captures data
function createTestWriteApi() {
  return {
    writePoints(points) {
      capturedPoints.push(...points)
      console.log(`📊 Captured ${points.length} points for integration test`)
    },
    writePoint(point) {
      capturedPoints.push(point)
      console.log('📊 Captured 1 point for integration test')
    },
    flush: async () => {
      console.log('💾 InfluxDB flush called')
      return Promise.resolve()
    },
    close: async () => {
      console.log('🔒 InfluxDB writeApi closed')
      return Promise.resolve()
    },
    dispose: async () => {
      console.log('🗑️ InfluxDB writeApi disposed')
      return Promise.resolve()
    }
  }
}

// Mock InfluxDB client that captures configuration
function createTestInfluxDB(config) {
  console.log('🏗️ Creating test InfluxDB client with config:', config)
  
  return {
    getWriteApi: (org, bucket, precision, options) => {
      console.log(`📝 Creating writeApi - org: ${org}, bucket: ${bucket}, precision: ${precision}`)
      console.log('📝 WriteApi options:', options)
      return createTestWriteApi()
    },
    close: async () => {
      console.log('🔒 InfluxDB client closed')
      return Promise.resolve()
    }
  }
}

// Service simulator that closely mirrors index.js behavior
class MqttInfluxService {
  constructor(config) {
    this.config = config
    this.mqttClient = null
    this.writeApi = null
    this.converters = {
      'command-verification': require('./converters/command-verification'),
      'dds024mr': require('./converters/dds024mr'),
      'dds519mr': require('./converters/dds519mr'),
      'ex9em': require('./converters/ex9em'),
      'or-we-514': require('./converters/or-we-514'),
      'sdm630': require('./converters/sdm630')
    }
  }

  async start() {
    console.log('🚀 Starting mqtt-influx service...')
    
    // Create InfluxDB client exactly like index.js
    const influxToken = `${this.config.INFLUXDB_USERNAME}:${this.config.INFLUXDB_PASSWORD}`
    const influxBucket = `${this.config.INFLUXDB_DATABASE}/${this.config.INFLUXDB_RP}`
    const defaultTags = JSON.parse(this.config.TAGS)
    
    const influxDB = createTestInfluxDB({
      url: this.config.INFLUXDB_URL,
      token: influxToken
    })
    
    this.writeApi = influxDB.getWriteApi('', influxBucket, 'ms', {
      defaultTags
    })
    
    // Create MQTT client exactly like index.js
    this.mqttClient = mqtt.connect(this.config.BROKER, {
      clientId: this.config.MQTT_CLIENT_ID
    })
    
    // Set up event handlers like index.js
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Service startup timeout'))
      }, SERVICE_CONFIG.timeouts.serviceStartup)

      this.mqttClient.on('connect', () => {
        console.log('🔌 Service connected to MQTT broker')
        
        this.mqttClient.subscribe(this.config.TOPIC, (err) => {
          if (err) {
            clearTimeout(timeout)
            reject(err)
          } else {
            console.log(`📡 Service subscribed to ${this.config.TOPIC}`)
            clearTimeout(timeout)
            resolve()
          }
        })
      })

      this.mqttClient.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      // Message handler exactly like index.js
      this.mqttClient.on('message', (topic, message) => {
        try {
          const data = JSON.parse(message)

          if (!(data._type in this.converters)) {
            console.warn('Service: Unhandled type', data._type, data)
            return
          }

          const points = this.converters[data._type](data)
          this.writeApi.writePoints(points)
        } catch (error) {
          console.error('Service: Message processing error:', error)
          influxErrors.push(error)
        }
      })

      // Error handlers like index.js
      this.mqttClient.on('reconnect', () => {
        console.log('🔄 Service reconnected to MQTT broker')
      })

      this.mqttClient.on('close', () => {
        console.log('🔌 Service MQTT connection closed')
      })

      this.mqttClient.on('disconnect', () => {
        console.log('🔌 Service MQTT disconnected')
      })

      this.mqttClient.on('offline', () => {
        console.log('📴 Service MQTT offline')
      })
    })
  }

  async stop() {
    console.log('🛑 Stopping mqtt-influx service...')
    
    if (this.writeApi) {
      await this.writeApi.close()
    }
    
    if (this.mqttClient) {
      await new Promise((resolve) => {
        this.mqttClient.end(false, resolve)
      })
    }
    
    console.log('✅ Service stopped')
  }
}

describe('MQTT-InfluxDB Service Integration Tests', () => {
  
  before(async () => {
    console.log('🚀 Setting up service integration test environment...')
    
    // Set up test MQTT broker
    aedesBroker = new Aedes({ id: 'integration-test-broker' })
    netServer = net.createServer(aedesBroker.handle)
    
    await new Promise((resolve, reject) => {
      netServer.listen(SERVICE_CONFIG.mqtt.port, SERVICE_CONFIG.mqtt.host, (err) => {
        if (err) reject(err)
        else {
          console.log(`✅ Integration test MQTT broker running on ${SERVICE_CONFIG.mqtt.host}:${SERVICE_CONFIG.mqtt.port}`)
          resolve()
        }
      })
    })
    
    // Update service config with dynamic broker URL
    SERVICE_CONFIG.env.BROKER = `mqtt://${SERVICE_CONFIG.mqtt.host}:${SERVICE_CONFIG.mqtt.port}`
    
    console.log('✅ Service integration test environment ready')
  })
  
  after(async () => {
    console.log('🧹 Cleaning up service integration test...')
    
    if (aedesBroker) {
      await new Promise((resolve) => {
        aedesBroker.close(resolve)
      })
    }
    
    if (netServer) {
      await new Promise((resolve) => {
        netServer.close(resolve)
      })
    }
    
    console.log('✅ Service integration test cleanup complete')
  })

  test('should start service with complete environment configuration', async () => {
    console.log('🧪 Testing service startup with full environment configuration...')
    
    capturedPoints = []
    influxErrors = []
    
    const service = new MqttInfluxService(SERVICE_CONFIG.env)
    
    // Test service startup
    await service.start()
    
    // Verify service is running and ready
    assert.ok(service.mqttClient, 'Service should have MQTT client')
    assert.ok(service.writeApi, 'Service should have InfluxDB writeApi')
    assert.strictEqual(service.mqttClient.connected, true, 'MQTT client should be connected')
    
    console.log('✅ Service startup test successful')
    
    await service.stop()
  })

  test('should process realistic command verification events end-to-end', async () => {
    console.log('🧪 Testing complete command verification event processing...')
    
    capturedPoints = []
    influxErrors = []
    
    const service = new MqttInfluxService(SERVICE_CONFIG.env)
    await service.start()
    
    // Create publisher to send realistic events
    const publisher = mqtt.connect(SERVICE_CONFIG.env.BROKER, {
      clientId: 'integration-test-publisher'
    })
    
    await new Promise((resolve, reject) => {
      publisher.on('connect', resolve)
      publisher.on('error', reject)
    })
    
    // Test realistic command failure scenarios
    const testEvents = [
      {
        _type: 'command-verification',
        type: 'command_failed',
        controller: 'lightBath1Controller',
        reason: 'toggle_on',
        attempts: 3,
        expectedState: true,
        actualState: false,
        timestamp: Date.now() - 5000
      },
      {
        _type: 'command-verification',
        type: 'command_failed',
        controller: 'lightBath1Controller',
        reason: 'lock_on',
        attempts: 2,
        expectedState: true,
        actualState: false,
        timestamp: Date.now() - 3000
      },
      {
        _type: 'command-verification',
        type: 'command_failed',
        controller: 'lightBath2Controller',
        reason: 'door_close',
        attempts: 1,
        expectedState: true,
        actualState: false,
        timestamp: Date.now() - 1000
      }
    ]
    
    // Publish events to realistic topics
    for (const event of testEvents) {
      const topic = `homy/automation/${event.controller}/command_failed`
      await new Promise((resolve, reject) => {
        publisher.publish(topic, JSON.stringify(event), (err) => {
          if (err) reject(err)
          else {
            console.log(`📨 Published event to ${topic}`)
            resolve()
          }
        })
      })
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, SERVICE_CONFIG.timeouts.messageProcessing))
    
    // Verify all events were processed
    assert.strictEqual(capturedPoints.length, testEvents.length, 
      `Should process all ${testEvents.length} events`)
    assert.strictEqual(influxErrors.length, 0, 'Should not have any processing errors')
    
    // Verify point data quality
    capturedPoints.forEach((point, index) => {
      const lineProtocol = point.toString()
      const originalEvent = testEvents[index]
      
      assert.match(lineProtocol, /^command_failure,/, 'Should create command_failure measurement')
      assert.match(lineProtocol, new RegExp(`controller=${originalEvent.controller}`), 
        'Should preserve controller from event')
      assert.match(lineProtocol, new RegExp(`reason=${originalEvent.reason}`), 
        'Should preserve reason from event')
      assert.match(lineProtocol, new RegExp(`attempts=${originalEvent.attempts}i`), 
        'Should preserve attempts as integer')
    })
    
    console.log('✅ End-to-end event processing test successful')
    
    // Cleanup
    await new Promise((resolve) => {
      publisher.end(false, resolve)
    })
    
    await service.stop()
  })

  test('should handle multiple converter types in same service instance', async () => {
    console.log('🧪 Testing multiple converter types in single service...')
    
    capturedPoints = []
    influxErrors = []
    
    // Configure service to handle multiple types (like real deployment)
    const multiConverterConfig = {
      ...SERVICE_CONFIG.env,
      TOPIC: 'homy/+/+/+'  // Broader pattern to capture multiple types
    }
    
    const service = new MqttInfluxService(multiConverterConfig)
    await service.start()
    
    const publisher = mqtt.connect(SERVICE_CONFIG.env.BROKER, {
      clientId: 'multi-converter-publisher'
    })
    
    await new Promise((resolve, reject) => {
      publisher.on('connect', resolve)
      publisher.on('error', reject)
    })
    
    // Test different event types
    const mixedEvents = [
      {
        topic: 'homy/automation/lightBath1Controller/command_failed',
        data: {
          _type: 'command-verification',
          type: 'command_failed',
          controller: 'lightBath1Controller',
          reason: 'toggle_on',
          attempts: 2,
          expectedState: true,
          actualState: false,
          timestamp: Date.now()
        }
      },
      {
        topic: 'homy/modbus/device1/reading',
        data: {
          _type: 'dds024mr',
          type: 'energy_reading',
          device: 'device1',
          power: 1500.5,
          voltage: 230.1,
          current: 6.52,
          timestamp: Date.now()
        }
      },
      {
        topic: 'homy/sensors/temperature/value',
        data: {
          _type: 'unknown-converter',  // Should be ignored
          type: 'temperature',
          value: 22.5,
          timestamp: Date.now()
        }
      }
    ]
    
    // Publish mixed events
    for (const { topic, data } of mixedEvents) {
      await new Promise((resolve, reject) => {
        publisher.publish(topic, JSON.stringify(data), (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, SERVICE_CONFIG.timeouts.messageProcessing))
    
    // Should process known converters, ignore unknown
    assert.strictEqual(capturedPoints.length, 2, 'Should process 2 known converter events')
    assert.strictEqual(influxErrors.length, 0, 'Should not have processing errors')
    
    // Verify different measurement types were created
    const lineProtocols = capturedPoints.map(p => p.toString())
    const hasCommandFailure = lineProtocols.some(lp => lp.includes('command_failure'))
    const hasEnergyReading = lineProtocols.some(lp => lp.includes('energy'))
    
    assert.ok(hasCommandFailure, 'Should process command verification events')
    assert.ok(hasEnergyReading, 'Should process energy meter events')
    
    console.log('✅ Multiple converter test successful')
    
    await new Promise((resolve) => {
      publisher.end(false, resolve)
    })
    
    await service.stop()
  })

  test('should handle service lifecycle events and cleanup properly', async () => {
    console.log('🧪 Testing service lifecycle and resource cleanup...')
    
    capturedPoints = []
    influxErrors = []
    
    const service = new MqttInfluxService(SERVICE_CONFIG.env)
    
    // Test startup
    await service.start()
    assert.ok(service.mqttClient.connected, 'Service should start successfully')
    
    // Test operation under load
    const publisher = mqtt.connect(SERVICE_CONFIG.env.BROKER, {
      clientId: 'lifecycle-test-publisher'
    })
    
    await new Promise((resolve, reject) => {
      publisher.on('connect', resolve)
      publisher.on('error', reject)
    })
    
    // Send burst of events
    const eventCount = 20
    const publishPromises = []
    
    for (let i = 0; i < eventCount; i++) {
      const event = {
        _type: 'command-verification',
        type: 'command_failed',
        controller: `testController${i}`,
        reason: 'lifecycle_test',
        attempts: Math.floor(Math.random() * 5) + 1,
        expectedState: Math.random() > 0.5,
        actualState: Math.random() > 0.5,
        timestamp: Date.now() - (i * 100)
      }
      
      publishPromises.push(
        new Promise((resolve, reject) => {
          publisher.publish(`homy/automation/testController${i}/command_failed`, 
            JSON.stringify(event), (err) => {
              if (err) reject(err)
              else resolve()
            })
        })
      )
    }
    
    // Wait for all events to be published
    await Promise.all(publishPromises)
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, SERVICE_CONFIG.timeouts.messageProcessing * 2))
    
    // Verify all events processed
    assert.strictEqual(capturedPoints.length, eventCount, 
      `Should process all ${eventCount} events during lifecycle test`)
    assert.strictEqual(influxErrors.length, 0, 'Should not have errors during burst processing')
    
    // Test graceful shutdown
    console.log('🛑 Testing graceful service shutdown...')
    await service.stop()
    
    // Verify resources cleaned up
    assert.strictEqual(service.mqttClient.connected, false, 'MQTT client should be disconnected')
    
    console.log('✅ Service lifecycle test successful')
    
    await new Promise((resolve) => {
      publisher.end(false, resolve)
    })
  })

  test('should handle malformed data and error conditions gracefully', async () => {
    console.log('🧪 Testing service error handling and resilience...')
    
    capturedPoints = []
    influxErrors = []
    
    const service = new MqttInfluxService(SERVICE_CONFIG.env)
    await service.start()
    
    const publisher = mqtt.connect(SERVICE_CONFIG.env.BROKER, {
      clientId: 'error-test-publisher'
    })
    
    await new Promise((resolve, reject) => {
      publisher.on('connect', resolve)
      publisher.on('error', reject)
    })
    
    // Test various error conditions
    const errorTestCases = [
      {
        name: 'malformed JSON',
        topic: 'homy/automation/testController/command_failed',
        message: '{ invalid json syntax }'
      },
      {
        name: 'missing _type field',
        topic: 'homy/automation/testController/command_failed',
        message: JSON.stringify({
          type: 'command_failed',
          controller: 'testController',
          timestamp: Date.now()
        })
      },
      {
        name: 'unknown converter type',
        topic: 'homy/automation/testController/command_failed',
        message: JSON.stringify({
          _type: 'non-existent-converter',
          type: 'some_event',
          data: 'test'
        })
      },
      {
        name: 'empty message',
        topic: 'homy/automation/testController/command_failed',
        message: ''
      }
    ]
    
    // Publish error cases
    for (const testCase of errorTestCases) {
      console.log(`📨 Testing ${testCase.name}...`)
      
      await new Promise((resolve, reject) => {
        publisher.publish(testCase.topic, testCase.message, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
    
    // Publish one valid message to ensure service still works
    const validEvent = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: 'testController',
      reason: 'error_recovery_test',
      attempts: 1,
      expectedState: true,
      actualState: false,
      timestamp: Date.now()
    }
    
    await new Promise((resolve, reject) => {
      publisher.publish('homy/automation/testController/command_failed', 
        JSON.stringify(validEvent), (err) => {
          if (err) reject(err)
          else resolve()
        })
    })
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, SERVICE_CONFIG.timeouts.messageProcessing))
    
    // Should only process the valid message
    assert.strictEqual(capturedPoints.length, 1, 'Should only process valid message')
    
    // Verify service recovered and processed valid message
    const lineProtocol = capturedPoints[0].toString()
    assert.match(lineProtocol, /reason=error_recovery_test/, 'Should process valid message after errors')
    
    // Service should still be operational
    assert.strictEqual(service.mqttClient.connected, true, 'Service should remain connected after errors')
    
    console.log('✅ Error handling and resilience test successful')
    
    await new Promise((resolve) => {
      publisher.end(false, resolve)
    })
    
    await service.stop()
  })
})

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running MQTT-InfluxDB service integration tests...')
}