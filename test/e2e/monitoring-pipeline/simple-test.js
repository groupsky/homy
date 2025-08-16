/**
 * Simple test to verify our test utilities work without Docker complexity
 */

import { test } from 'node:test'
import assert from 'node:assert'

console.log('🧪 Running simple test verification...')

test('should verify test framework is working', () => {
  console.log('✅ Test framework is working')
  assert.strictEqual(2 + 2, 4, 'Basic math should work')
})

test('should verify imports work', async () => {
  console.log('✅ Testing imports...')
  
  try {
    const { createMqttClient } = await import('./lib/mqtt-client.js')
    assert.ok(createMqttClient, 'MQTT client import should work')
    console.log('✅ MQTT client import successful')
  } catch (error) {
    console.log(`❌ MQTT client import failed: ${error.message}`)
    throw error
  }
  
  try {
    const { createInfluxClient } = await import('./lib/influx-client.js')
    assert.ok(createInfluxClient, 'InfluxDB client import should work')
    console.log('✅ InfluxDB client import successful')
  } catch (error) {
    console.log(`❌ InfluxDB client import failed: ${error.message}`)
    throw error
  }
  
  try {
    const { checkGrafanaHealth } = await import('./lib/grafana-client.js')
    assert.ok(checkGrafanaHealth, 'Grafana client import should work')
    console.log('✅ Grafana client import successful')
  } catch (error) {
    console.log(`❌ Grafana client import failed: ${error.message}`)
    throw error
  }
})

console.log('🎯 Simple test verification completed')