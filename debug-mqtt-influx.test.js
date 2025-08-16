#!/usr/bin/env node

/**
 * Debug MQTT-InfluxDB Message Processing
 * 
 * Direct debugging test to identify why mqtt-influx-automation service
 * is not processing MQTT messages in the Docker environment.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert'
import { execSync } from 'child_process'

function runDockerCommand(command) {
  try {
    const result = execSync(command, { encoding: 'utf8', cwd: '/home/groupsky/src/homy' })
    return { success: true, output: result.trim() }
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout || '', stderr: error.stderr || '' }
  }
}

describe('MQTT-InfluxDB Message Processing Debug', () => {
  
  test('should verify mqtt-influx service environment and configuration', () => {
    console.log('🔍 Debugging mqtt-influx-automation service...')
    
    // Check service environment variables
    const envResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 env | grep -E "(BROKER|TOPIC|INFLUXDB|MQTT_CLIENT_ID)"'
    )
    
    if (envResult.success) {
      console.log('Environment variables:')
      console.log(envResult.output)
    } else {
      console.log('Failed to get environment:', envResult.error)
    }
    
    // Check if converter file exists and is accessible
    const converterResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 ls -la /app/converters/'
    )
    
    if (converterResult.success) {
      console.log('Available converters:')
      console.log(converterResult.output)
    } else {
      console.log('Failed to list converters:', converterResult.error)
    }
    
    // Check if command-verification converter exists
    const converterFileResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 cat /app/converters/command-verification.js | head -20'
    )
    
    if (converterFileResult.success) {
      console.log('Command verification converter (first 20 lines):')
      console.log(converterFileResult.output)
    } else {
      console.log('Failed to read converter file:', converterFileResult.error)
    }
    
    assert.ok(true, 'Environment debug completed')
  })

  test('should verify MQTT message publishing and subscription', async () => {
    console.log('📡 Testing MQTT message flow...')
    
    // Test 1: Publish message and check mqtt-influx logs immediately
    console.log('Publishing test message...')
    const publishResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-broker-1 mosquitto_pub -t "homy/automation/debugController/command_failed" ' +
      '-m \'{"_type":"command-verification","type":"command_failed","controller":"debugController","reason":"debug_test","attempts":1,"expectedState":true,"actualState":false,"timestamp":' + Date.now() + '}\''
    )
    
    if (publishResult.success) {
      console.log('✅ Message published successfully')
    } else {
      console.log('❌ Failed to publish message:', publishResult.error)
    }
    
    // Wait a moment for processing
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Check mqtt-influx logs for any activity
    const logsResult = runDockerCommand(
      'docker compose --env-file test/e2e/monitoring-pipeline/.env.test -f docker-compose.yml -f test/e2e/monitoring-pipeline/docker-compose.test.yml logs --tail=10 mqtt-influx-automation'
    )
    
    console.log('Recent mqtt-influx-automation logs:')
    console.log(logsResult.output)
    
    // Test 2: Check if broker is working by subscribing to all topics
    console.log('Testing broker message flow...')
    const subResult = runDockerCommand(
      'timeout 3 docker exec homy-monitoring-e2e-broker-1 mosquitto_sub -t "#" -C 1 || echo "Timeout reached"'
    )
    
    console.log('Broker subscription test result:')
    console.log(subResult.output)
    
    assert.ok(true, 'MQTT flow debug completed')
  })

  test('should test InfluxDB connectivity from mqtt-influx container', () => {
    console.log('🗃️ Testing InfluxDB connectivity...')
    
    // Test InfluxDB connection from mqtt-influx container
    const influxConnResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 sh -c "nc -zv influxdb 8086"'
    )
    
    if (influxConnResult.success) {
      console.log('✅ InfluxDB connectivity confirmed')
    } else {
      console.log('❌ InfluxDB connectivity failed:', influxConnResult.stderr)
    }
    
    // Check InfluxDB ping
    const influxPingResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-influxdb-1 influx -execute "SHOW DATABASES"'
    )
    
    if (influxPingResult.success) {
      console.log('InfluxDB databases:')
      console.log(influxPingResult.output)
    } else {
      console.log('InfluxDB ping failed:', influxPingResult.error)
    }
    
    // Check if mqtt-influx can write to InfluxDB manually
    const testWriteResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-influxdb-1 influx -database homy -execute "SELECT * FROM command_failure LIMIT 1"'
    )
    
    console.log('InfluxDB query test:')
    console.log(testWriteResult.output || testWriteResult.error)
    
    assert.ok(true, 'InfluxDB connectivity debug completed')
  })

  test('should examine mqtt-influx service process and logs in detail', () => {
    console.log('🔧 Examining mqtt-influx service internals...')
    
    // Check running processes in container
    const processResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 ps aux'
    )
    
    console.log('Running processes in mqtt-influx container:')
    console.log(processResult.output)
    
    // Check if the service is actually running the correct command
    const cmdResult = runDockerCommand(
      'docker inspect homy-monitoring-e2e-mqtt-influx-automation-1 --format "{{.Config.Cmd}}"'
    )
    
    console.log('Container command:')
    console.log(cmdResult.output)
    
    // Check working directory and files
    const workdirResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 pwd && ls -la'
    )
    
    console.log('Working directory and files:')
    console.log(workdirResult.output)
    
    // Check if index.js exists and is executable
    const indexResult = runDockerCommand(
      'docker exec homy-monitoring-e2e-mqtt-influx-automation-1 cat index.js | head -30'
    )
    
    console.log('Index.js file (first 30 lines):')
    console.log(indexResult.output)
    
    assert.ok(true, 'Service internals debug completed')
  })
})

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🐛 Running MQTT-InfluxDB debug tests...')
}