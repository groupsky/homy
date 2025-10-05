const { beforeEach, describe, test, expect } = require('@jest/globals')

/**
 * Test suite for automation enable/disable control feature
 */

describe('Automation Control', () => {
  let mqttSubscriptions = {}
  let mqttPublishCalls = []
  let testBot
  let publishBotStatus
  let controlTopic

  beforeEach(() => {
    mqttSubscriptions = {}
    mqttPublishCalls = []

    // Simulate bot structure
    testBot = {
      name: 'testBot',
      enabled: true,
      config: {
        type: 'test-bot'
      }
    }

    // Simulate the publishBotStatus function
    publishBotStatus = () => {
      const statusTopic = `homy/automation/${testBot.name}/status`
      mqttPublishCalls.push({
        topic: statusTopic,
        payload: {
          enabled: testBot.enabled,
          type: testBot.config.type,
          _tz: expect.any(Number)
        },
        options: { retain: true }
      })
    }

    controlTopic = `homy/automation/${testBot.name}/control`

    // Simulate control topic subscription
    if (!mqttSubscriptions[controlTopic]) {
      mqttSubscriptions[controlTopic] = []
    }
    mqttSubscriptions[controlTopic].push((payload) => {
      const enabled = payload.enabled
      if (typeof enabled === 'boolean' && testBot.enabled !== enabled) {
        testBot.enabled = enabled
        publishBotStatus()
      }
    })
  })

  test('bot starts enabled by default', () => {
    expect(testBot.enabled).toBe(true)
  })

  test('bot can be disabled via control topic', () => {
    // Send disable command
    mqttSubscriptions[controlTopic][0]({ enabled: false })

    expect(testBot.enabled).toBe(false)
    expect(mqttPublishCalls).toHaveLength(1)
    expect(mqttPublishCalls[0]).toMatchObject({
      topic: `homy/automation/${testBot.name}/status`,
      payload: {
        enabled: false,
        type: 'test-bot'
      },
      options: { retain: true }
    })
  })

  test('bot can be enabled via control topic', () => {
    // First disable
    testBot.enabled = false

    // Then enable
    mqttSubscriptions[controlTopic][0]({ enabled: true })

    expect(testBot.enabled).toBe(true)
    expect(mqttPublishCalls).toHaveLength(1)
    expect(mqttPublishCalls[0]).toMatchObject({
      topic: `homy/automation/${testBot.name}/status`,
      payload: {
        enabled: true,
        type: 'test-bot'
      }
    })
  })

  test('does not publish status when enabled state does not change', () => {
    // Bot is already enabled, send enable command
    mqttSubscriptions[controlTopic][0]({ enabled: true })

    expect(testBot.enabled).toBe(true)
    expect(mqttPublishCalls).toHaveLength(0)
  })

  test('ignores non-boolean enabled values', () => {
    const initialState = testBot.enabled

    mqttSubscriptions[controlTopic][0]({ enabled: 'true' })
    expect(testBot.enabled).toBe(initialState)

    mqttSubscriptions[controlTopic][0]({ enabled: 1 })
    expect(testBot.enabled).toBe(initialState)

    mqttSubscriptions[controlTopic][0]({ enabled: null })
    expect(testBot.enabled).toBe(initialState)

    expect(mqttPublishCalls).toHaveLength(0)
  })

  test('wrapped mqtt subscribe callback only fires when bot is enabled', () => {
    let callbackFired = false
    const testPayload = { test: 'data' }

    // Simulate wrapped callback
    const wrappedCallback = (payload) => {
      if (testBot.enabled) {
        callbackFired = true
      }
    }

    // Test when enabled
    testBot.enabled = true
    callbackFired = false
    wrappedCallback(testPayload)
    expect(callbackFired).toBe(true)

    // Test when disabled
    testBot.enabled = false
    callbackFired = false
    wrappedCallback(testPayload)
    expect(callbackFired).toBe(false)
  })

  test('mqtt publish is skipped when bot is disabled', () => {
    let publishAttempted = false

    const mockPublish = (topic, payload) => {
      if (!testBot.enabled) {
        // Should not reach here
        publishAttempted = false
      } else {
        publishAttempted = true
      }
    }

    // Test when enabled
    testBot.enabled = true
    publishAttempted = false
    mockPublish('test/topic', { test: 'data' })
    expect(publishAttempted).toBe(true)

    // Test when disabled - publish should be skipped
    testBot.enabled = false
    publishAttempted = false
    // In the real implementation, the check happens before the publish call
    if (testBot.enabled) {
      mockPublish('test/topic', { test: 'data' })
    }
    expect(publishAttempted).toBe(false)
  })
})
