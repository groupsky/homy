/**
 * MQTT client utilities for E2E testing
 * Provides functions to publish test events and manage MQTT connections
 */

import mqtt from 'mqtt'

/**
 * Publish bath-lights command failure events for testing
 * @param {mqtt.MqttClient} client - Connected MQTT client
 * @param {Array} events - Array of failure events to publish
 */
export async function publishFailureEvents(client, events) {
  console.log(`Publishing ${events.length} failure events...`)
  
  for (const event of events) {
    // Ensure all required fields are present
    const message = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: event.controller || 'unknown',
      reason: event.reason || 'unknown',
      attempts: parseInt(event.attempts) || 1,
      expectedState: Boolean(event.expectedState),
      actualState: Boolean(event.actualState),
      timestamp: Date.now()
    }
    
    // Validate required fields
    if (!message.controller || !message.reason || isNaN(message.attempts)) {
      console.error('Invalid event data:', event)
      continue
    }
    
    const topic = `homy/automation/${event.controller}/command_failed`
    console.log(`Publishing to ${topic}:`, message)
    
    await new Promise((resolve, reject) => {
      client.publish(topic, JSON.stringify(message), (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    
    // Small delay between events to ensure proper ordering
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  console.log('All failure events published successfully')
}

/**
 * Create and connect MQTT client with proper error handling
 * @param {string} brokerUrl - MQTT broker URL
 * @returns {Promise<mqtt.MqttClient>} Connected MQTT client
 */
export async function createMqttClient(brokerUrl = 'mqtt://localhost:1883') {
  console.log(`Connecting to MQTT broker: ${brokerUrl}`)
  
  const client = mqtt.connect(brokerUrl, {
    clientId: `e2e-test-${Date.now()}`,
    keepalive: 30,
    connectTimeout: 5000,
    reconnectPeriod: 1000
  })
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MQTT connection timeout'))
    }, 10000)
    
    client.on('connect', () => {
      clearTimeout(timeout)
      console.log('MQTT client connected successfully')
      resolve(client)
    })
    
    client.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

/**
 * Gracefully disconnect MQTT client
 * @param {mqtt.MqttClient} client - MQTT client to disconnect
 */
export async function disconnectMqttClient(client) {
  if (client && client.connected) {
    console.log('Disconnecting MQTT client...')
    await new Promise((resolve) => {
      client.end(false, resolve)
    })
    console.log('MQTT client disconnected')
  }
}