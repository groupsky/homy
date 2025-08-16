#!/usr/bin/env node

/**
 * Unit test for command-verification converter
 * Tests converter logic with minimal mocking following Node.js testing best practices
 * 
 * Approach: Test the converter as a pure function that transforms input to InfluxDB Points
 * - No mocking of InfluxDB internals
 * - Test output using line protocol format (toString())
 * - Focus on what the converter produces, not how it works internally
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')

// Load converter directly - uses real InfluxDB client dependency
const converter = require('./command-verification.js')

describe('Command Verification Converter', () => {
  test('should convert command_failed event to correct InfluxDB point', () => {
    const inputData = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: 'lightBath1Controller',
      reason: 'toggle_on',
      attempts: 3,
      expectedState: true,
      actualState: false,
      timestamp: 1625097600000
    }

    const points = converter(inputData)

    // Verify basic structure
    assert.strictEqual(points.length, 1, 'Should return exactly one point')
    
    // Test using InfluxDB line protocol output - this is the authoritative format
    const lineProtocol = points[0].toString()
    
    // Verify measurement and structure using line protocol
    assert.match(lineProtocol, /^command_failure,/, 'Should create command_failure measurement')
    assert.match(lineProtocol, /controller=lightBath1Controller/, 'Should include controller tag')
    assert.match(lineProtocol, /reason=toggle_on/, 'Should include reason tag')
    assert.match(lineProtocol, /attempts=3i/, 'Should include attempts as integer field')
    assert.match(lineProtocol, /expected_state=T/, 'Should include expected_state as true boolean')
    assert.match(lineProtocol, /actual_state=F/, 'Should include actual_state as false boolean')
    assert.match(lineProtocol, /1625097600000000000$/, 'Should include timestamp in nanoseconds')
  })

  test('should return empty array for unknown event types', () => {
    const inputData = {
      _type: 'command-verification',
      type: 'unknown_event_type',
      controller: 'testController',
      timestamp: 1625097600000
    }

    const points = converter(inputData)
    assert.strictEqual(points.length, 0, 'Should return empty array for unknown event type')
  })

  test('should handle boolean values correctly', () => {
    const testCases = [
      { expectedState: true, actualState: true, expectedExp: 'T', actualExp: 'T' },
      { expectedState: false, actualState: false, expectedExp: 'F', actualExp: 'F' },
      { expectedState: true, actualState: false, expectedExp: 'T', actualExp: 'F' },
      { expectedState: false, actualState: true, expectedExp: 'F', actualExp: 'T' }
    ]

    testCases.forEach(({ expectedState, actualState, expectedExp, actualExp }, index) => {
      const inputData = {
        _type: 'command-verification',
        type: 'command_failed',
        controller: `testController${index}`,
        reason: 'test_reason',
        attempts: 1,
        expectedState,
        actualState,
        timestamp: 1625097600000
      }

      const points = converter(inputData)
      const lineProtocol = points[0].toString()
      
      assert.match(lineProtocol, new RegExp(`expected_state=${expectedExp}`), 
        `Should encode expectedState=${expectedState} as ${expectedExp}`)
      assert.match(lineProtocol, new RegExp(`actual_state=${actualExp}`), 
        `Should encode actualState=${actualState} as ${actualExp}`)
    })
  })

  test('should handle different attempt values as integers', () => {
    const testAttempts = [1, 5, 10, 999]

    testAttempts.forEach(attempts => {
      const inputData = {
        _type: 'command-verification',
        type: 'command_failed',
        controller: 'testController',
        reason: 'test_reason',
        attempts,
        expectedState: true,
        actualState: false,
        timestamp: 1625097600000
      }

      const points = converter(inputData)
      const lineProtocol = points[0].toString()
      
      assert.match(lineProtocol, new RegExp(`attempts=${attempts}i`), 
        `Should encode attempts=${attempts} as integer field`)
    })
  })

  test('should match exact format from E2E test MQTT messages', () => {
    // Test with exact message format from E2E tests to ensure compatibility
    const inputData = {
      _type: 'command-verification',
      type: 'command_failed',
      controller: 'lightBath1Controller',
      reason: 'toggle_on',
      attempts: 3,
      expectedState: true,
      actualState: false,
      timestamp: 1755370782397
    }

    const points = converter(inputData)
    
    assert.strictEqual(points.length, 1, 'Should process E2E test message format')
    
    const lineProtocol = points[0].toString()
    
    // Verify this exact format works and produces expected output
    assert.match(lineProtocol, /^command_failure,/, 'Should create command_failure measurement')
    assert.match(lineProtocol, /controller=lightBath1Controller/, 'Should include controller from E2E test')
    assert.match(lineProtocol, /reason=toggle_on/, 'Should include reason from E2E test')
    assert.match(lineProtocol, /attempts=3i/, 'Should include attempts from E2E test')
    assert.match(lineProtocol, /expected_state=T/, 'Should include expected_state from E2E test')
    assert.match(lineProtocol, /actual_state=F/, 'Should include actual_state from E2E test')
  })

  test('should preserve timestamp precision', () => {
    const timestamps = [
      1625097600000,    // Round seconds
      1625097600123,    // With milliseconds
      1625097600999     // Edge case milliseconds
    ]

    timestamps.forEach(timestamp => {
      const inputData = {
        _type: 'command-verification',
        type: 'command_failed',
        controller: 'testController',
        reason: 'test_reason',
        attempts: 1,
        expectedState: true,
        actualState: false,
        timestamp
      }

      const points = converter(inputData)
      const lineProtocol = points[0].toString()
      
      // InfluxDB stores timestamps in nanoseconds (multiply by 1,000,000)
      const expectedNanoseconds = timestamp * 1000000
      assert.match(lineProtocol, new RegExp(`${expectedNanoseconds}$`), 
        `Should preserve timestamp precision for ${timestamp}`)
    })
  })
})

// Run the tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Running command-verification converter unit tests...')
}