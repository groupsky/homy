#!/usr/bin/env node

/**
 * Docker Connectivity Diagnostic Test
 * 
 * Investigates E2E test failures by testing Docker service connectivity
 * and environment setup with minimal mocking approach.
 * 
 * This test identifies the root cause of E2E failures by systematically
 * checking each component of the testing infrastructure.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert'
import { execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

// Test configuration
const DOCKER_CONFIG = {
  composeFiles: [
    'docker-compose.yml',
    'test/e2e/monitoring-pipeline/docker-compose.test.yml'
  ],
  services: ['broker', 'influxdb', 'grafana', 'mqtt-influx-automation'],
  envFile: 'test/e2e/monitoring-pipeline/.env.test',
  timeouts: {
    serviceStart: 60000,
    healthCheck: 10000
  }
}

// Expected service configuration
const SERVICE_ENDPOINTS = {
  broker: { internal: 'mqtt://broker:1883', external: null },
  influxdb: { internal: 'http://influxdb:8086', external: null },
  grafana: { internal: 'http://grafana:3000', external: null }
}

// Helper functions
function runCommand(command, options = {}) {
  try {
    const result = execSync(command, { 
      encoding: 'utf8',
      cwd: '/home/groupsky/src/homy',
      ...options 
    })
    return { success: true, output: result.trim() }
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      output: error.stdout || '',
      stderr: error.stderr || ''
    }
  }
}

async function waitForCondition(condition, timeoutMs = 30000, intervalMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return false
}

describe('Docker Connectivity Diagnostic Tests', () => {
  
  test('should verify Docker Compose environment is properly configured', () => {
    console.log('🔧 Testing Docker Compose configuration...')
    
    // Check if docker-compose.yml exists
    const mainComposeFile = '/home/groupsky/src/homy/docker-compose.yml'
    assert.ok(fs.existsSync(mainComposeFile), 'Main docker-compose.yml should exist')
    
    // Check if test overlay exists
    const testComposeFile = '/home/groupsky/src/homy/test/e2e/monitoring-pipeline/docker-compose.test.yml'
    assert.ok(fs.existsSync(testComposeFile), 'Test docker-compose.test.yml should exist')
    
    // Check if test environment file exists
    const envFile = '/home/groupsky/src/homy/test/e2e/monitoring-pipeline/.env.test'
    assert.ok(fs.existsSync(envFile), 'Test .env.test file should exist')
    
    // Validate docker-compose config
    const configResult = runCommand('docker compose -f docker-compose.yml -f test/e2e/monitoring-pipeline/docker-compose.test.yml config --services')
    assert.ok(configResult.success, `Docker Compose config should be valid: ${configResult.error || ''}`)
    
    const services = configResult.output.split('\n').filter(s => s.trim())
    console.log(`✅ Found ${services.length} configured services: ${services.join(', ')}`)
    
    // Verify required services are configured
    for (const requiredService of DOCKER_CONFIG.services) {
      assert.ok(services.includes(requiredService), 
        `Required service ${requiredService} should be configured`)
    }
    
    console.log('✅ Docker Compose configuration is valid')
  })

  test('should verify Docker daemon and compose are available', () => {
    console.log('🐳 Testing Docker availability...')
    
    // Check Docker daemon
    const dockerResult = runCommand('docker version --format "{{.Server.Version}}"')
    assert.ok(dockerResult.success, 'Docker daemon should be running')
    console.log(`✅ Docker daemon version: ${dockerResult.output}`)
    
    // Check Docker Compose
    const composeResult = runCommand('docker compose version --short')
    assert.ok(composeResult.success, 'Docker Compose should be available')
    console.log(`✅ Docker Compose version: ${composeResult.output}`)
    
    // Check if we can list containers
    const psResult = runCommand('docker ps --format "table {{.Names}}\t{{.Status}}"')
    assert.ok(psResult.success, 'Should be able to list containers')
    console.log(`✅ Docker is accessible`)
  })

  test('should detect current Docker service state', () => {
    console.log('📊 Analyzing current Docker service state...')
    
    // Check if services are currently running
    const psResult = runCommand('docker compose ps --services --filter status=running')
    const runningServices = psResult.success ? 
      psResult.output.split('\n').filter(s => s.trim()) : []
    
    console.log(`Currently running services: ${runningServices.length > 0 ? runningServices.join(', ') : 'none'}`)
    
    // Check if any monitoring-related containers exist
    const monitoringResult = runCommand('docker ps --filter "name=homy" --format "{{.Names}}\t{{.Status}}"')
    if (monitoringResult.success && monitoringResult.output) {
      console.log('Existing monitoring containers:')
      console.log(monitoringResult.output)
    } else {
      console.log('ℹ️  No monitoring containers currently running')
    }
    
    // Check for test-specific containers
    const testResult = runCommand('docker ps -a --filter "name=e2e" --format "{{.Names}}\t{{.Status}}"')
    if (testResult.success && testResult.output) {
      console.log('Existing E2E test containers:')
      console.log(testResult.output)
    }
    
    // This test always passes - it's diagnostic only
    assert.ok(true, 'Service state analysis completed')
  })

  test('should verify test environment secrets and configuration', () => {
    console.log('🔐 Testing secrets and environment configuration...')
    
    // Check test secrets directory
    const testSecretsDir = '/home/groupsky/src/homy/secrets.test'
    const secretsExist = fs.existsSync(testSecretsDir)
    
    if (secretsExist) {
      console.log('✅ Test secrets directory exists')
      
      // Check for required secret files
      const requiredSecrets = [
        'influxdb_write_user',
        'influxdb_write_user_password',
        'telegram_bot_token',
        'telegram_chat_id'
      ]
      
      for (const secret of requiredSecrets) {
        const secretFile = path.join(testSecretsDir, secret)
        if (fs.existsSync(secretFile)) {
          const content = fs.readFileSync(secretFile, 'utf8').trim()
          console.log(`✅ Secret ${secret}: ${content.length > 0 ? 'present' : 'empty'}`)
        } else {
          console.log(`⚠️  Secret ${secret}: missing`)
        }
      }
    } else {
      console.log('⚠️  Test secrets directory does not exist at ' + testSecretsDir)
      console.log('ℹ️  E2E tests may fail without proper secrets configuration')
    }
    
    // Check .env.test file content
    const envTestFile = '/home/groupsky/src/homy/test/e2e/monitoring-pipeline/.env.test'
    if (fs.existsSync(envTestFile)) {
      const envContent = fs.readFileSync(envTestFile, 'utf8')
      console.log('✅ .env.test content:')
      envContent.split('\n').forEach(line => {
        if (line.trim() && !line.startsWith('#')) {
          console.log(`  ${line}`)
        }
      })
    }
    
    assert.ok(true, 'Environment configuration check completed')
  })

  test('should test Docker service startup capability', async () => {
    console.log('🚀 Testing Docker service startup capability...')
    
    // First, check if services are already running
    const initialState = runCommand('docker compose ps --services --filter status=running')
    const initialRunning = initialState.success ? 
      initialState.output.split('\n').filter(s => s.trim()) : []
    
    if (initialRunning.length > 0) {
      console.log(`ℹ️  Services already running: ${initialRunning.join(', ')}`)
      console.log('ℹ️  Skipping startup test to avoid conflicts')
      return
    }
    
    console.log('📦 Testing service startup with test configuration...')
    
    // Try to start a minimal set of services for testing
    const startCommand = [
      'docker', 'compose',
      '--env-file', 'test/e2e/monitoring-pipeline/.env.test',
      '-f', 'docker-compose.yml',
      '-f', 'test/e2e/monitoring-pipeline/docker-compose.test.yml',
      'up', '-d', '--no-deps', 'broker'  // Start just broker first
    ].join(' ')
    
    console.log(`Running: ${startCommand}`)
    const startResult = runCommand(startCommand)
    
    if (startResult.success) {
      console.log('✅ Successfully started test broker service')
      
      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 5000))
      
      // Check if broker is running
      const brokerStatus = runCommand('docker compose ps broker')
      console.log('Broker status:', brokerStatus.output)
      
      // Clean up - stop the test service
      const stopResult = runCommand('docker compose --env-file test/e2e/monitoring-pipeline/.env.test -f docker-compose.yml -f test/e2e/monitoring-pipeline/docker-compose.test.yml down')
      if (stopResult.success) {
        console.log('✅ Successfully cleaned up test services')
      }
      
    } else {
      console.log('❌ Failed to start test services:')
      console.log('Error:', startResult.error)
      console.log('Output:', startResult.output)
      console.log('Stderr:', startResult.stderr)
      
      // This might be expected if Docker isn't fully set up
      console.log('ℹ️  This indicates E2E tests require manual Docker setup')
    }
    
    assert.ok(true, 'Service startup test completed')
  })

  test('should provide E2E test environment setup guidance', () => {
    console.log('📋 Providing E2E test environment setup guidance...')
    
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        E2E Test Environment Setup                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║ To run E2E tests, you need to start the Docker services first:              ║
║                                                                              ║
║ 1. Setup test secrets (if not already done):                                ║
║    cd /home/groupsky/src/homy/test/e2e/monitoring-pipeline                  ║
║    ./setup-test-secrets.sh                                                  ║
║                                                                              ║
║ 2. Start the test environment:                                              ║
║    cd /home/groupsky/src/homy                                               ║
║    docker compose --env-file test/e2e/monitoring-pipeline/.env.test \\       ║
║      -f docker-compose.yml \\                                                ║
║      -f test/e2e/monitoring-pipeline/docker-compose.test.yml \\              ║
║      up -d                                                                   ║
║                                                                              ║
║ 3. Wait for services to be ready (60+ seconds), then run:                   ║
║    cd test/e2e/monitoring-pipeline                                          ║
║    npm test                                                                  ║
║                                                                              ║
║ 4. Clean up after testing:                                                  ║
║    docker compose --env-file test/e2e/monitoring-pipeline/.env.test \\       ║
║      -f docker-compose.yml \\                                                ║
║      -f test/e2e/monitoring-pipeline/docker-compose.test.yml \\              ║
║      down                                                                    ║
║                                                                              ║
║ Alternative quick test setup:                                               ║
║    cd test/e2e/monitoring-pipeline                                          ║
║    ./run-test.sh                                                            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `)
    
    // Check if run-test.sh exists and is executable
    const runTestScript = '/home/groupsky/src/homy/test/e2e/monitoring-pipeline/run-test.sh'
    if (fs.existsSync(runTestScript)) {
      const stats = fs.statSync(runTestScript)
      const isExecutable = (stats.mode & parseInt('111', 8)) !== 0
      console.log(`✅ Found run-test.sh script (${isExecutable ? 'executable' : 'not executable'})`)
    } else {
      console.log('ℹ️  run-test.sh script not found - manual setup required')
    }
    
    assert.ok(true, 'Setup guidance provided')
  })
})

// Run diagnostics if this file is executed directly
if (require.main === module) {
  console.log('🔍 Running Docker connectivity diagnostics...')
}