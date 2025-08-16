#!/usr/bin/env node

/**
 * Direct MQTT test to replicate exact service configuration
 * Tests if E2E MQTT client configuration matches service configuration
 */

const mqtt = require('mqtt')

// Use exact same configuration as mqtt-influx services
const brokerUrl = 'mqtt://broker'  // Same as services
const clientId = 'test-direct-mqtt'  // Unique client ID

console.log('🧪 Testing MQTT with service-like configuration...')
console.log('Broker URL:', brokerUrl)
console.log('Client ID:', clientId)

// Create client with minimal configuration like services
const publishClient = mqtt.connect(brokerUrl, {
  clientId: clientId
})

const subscribeClient = mqtt.connect(brokerUrl, {
  clientId: clientId + '-sub'
})

// Subscribe to the same pattern as mqtt-influx-automation
subscribeClient.on('connect', () => {
  console.log('✅ Subscribe client connected')
  subscribeClient.subscribe('homy/automation/+/command_failed', (err) => {
    if (err) {
      console.error('❌ Subscribe error:', err)
    } else {
      console.log('✅ Subscribed to homy/automation/+/command_failed')
    }
  })
})

subscribeClient.on('message', (topic, message) => {
  console.log('📨 Received message:', {
    topic,
    message: message.toString()
  })
  process.exit(0)
})

// Publish after connection
publishClient.on('connect', () => {
  console.log('✅ Publish client connected')
  
  const testMessage = {
    _type: 'command-verification',
    type: 'command_failed',
    controller: 'testDirectController',
    reason: 'direct_test',
    attempts: 1,
    expectedState: true,
    actualState: false,
    timestamp: Date.now()
  }
  
  const topic = 'homy/automation/testDirectController/command_failed'
  console.log('📤 Publishing to:', topic)
  console.log('📄 Message:', testMessage)
  
  publishClient.publish(topic, JSON.stringify(testMessage), (err) => {
    if (err) {
      console.error('❌ Publish error:', err)
    } else {
      console.log('✅ Message published successfully')
    }
  })
})

publishClient.on('error', (err) => {
  console.error('❌ Publish client error:', err)
})

subscribeClient.on('error', (err) => {
  console.error('❌ Subscribe client error:', err)
})

// Timeout after 10 seconds
setTimeout(() => {
  console.log('⏰ Test timeout - no message received')
  process.exit(1)
}, 10000)