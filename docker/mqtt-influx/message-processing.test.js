// End-to-end test for message processing simulation
// Tests the complete flow: MQTT message → converter → InfluxDB point

const { SAMPLE_BOILER_CONTROLLER_STATUS } = require('./test-constants')

describe('message processing flow', () => {
  // Simulate the main message processing logic from index.js
  const simulateMessageProcessing = (topic, messageBuffer) => {
    const data = JSON.parse(messageBuffer)

    // This is the converters object from index.js
    const converters = {
      dds024mr: require('./converters/dds024mr'),
      dds519mr: require('./converters/dds519mr'),
      ex9em: require('./converters/ex9em'),
      'or-we-514': require('./converters/or-we-514'),
      sdm630: require('./converters/sdm630'),
      'automation-status': require('./converters/automation-status'),
    }

    if (!(data._type in converters)) {
      return { error: `Unhandled type ${data._type}` }
    }

    const points = converters[data._type](data)
    return { success: true, points }
  }

  it('should process automation status message successfully', () => {
    const mqttMessage = {
      ...SAMPLE_BOILER_CONTROLLER_STATUS,
      _type: 'automation-status'
    }

    const messageBuffer = JSON.stringify(mqttMessage)
    const result = simulateMessageProcessing('homy/automation/boiler_controller/status', messageBuffer)

    expect(result.success).toBe(true)
    expect(result.points).toBeDefined()
    expect(result.points.length).toBe(1)

    const point = result.points[0]
    expect(point.name).toBe('automation_status')
    expect(point.tags.service).toBe('boiler_controller')
    expect(point.fields.reason).toContain('comfort_heating_top')
  })

  it('should handle unknown message type gracefully', () => {
    const unknownMessage = {
      _type: 'unknown-device-type',
      someData: 'value'
    }

    const messageBuffer = JSON.stringify(unknownMessage)
    const result = simulateMessageProcessing('some/topic', messageBuffer)

    expect(result.error).toBe('Unhandled type unknown-device-type')
    expect(result.points).toBeUndefined()
  })

  it('should handle malformed JSON gracefully', () => {
    const malformedMessage = '{"invalid": json}'

    expect(() => {
      simulateMessageProcessing('some/topic', malformedMessage)
    }).toThrow()
  })
})

describe('production readiness checks', () => {
  it('should handle all expected automation status scenarios', () => {
    const testScenarios = [
      {
        name: 'automatic mode with electric heating',
        data: {
          _type: 'automation-status',
          reason: 'comfort_heating_top_45.2C',
          controlMode: 'automatic',
          manualOverrideExpires: null,
          heaterState: true,
          _tz: Date.now()
        }
      },
      {
        name: 'manual override with expiry',
        data: {
          _type: 'automation-status',
          reason: 'manual_on (expires: tomorrow)',
          controlMode: 'manual_on',
          manualOverrideExpires: Date.now() + 86400000,
          heaterState: true,
          _tz: Date.now()
        }
      },
      {
        name: 'vacation mode',
        data: {
          _type: 'automation-status',
          reason: 'vacation_7d (expires: next week)',
          controlMode: 'vacation_7d',
          manualOverrideExpires: Date.now() + 604800000,
          heaterState: false,
          _tz: Date.now()
        }
      }
    ]

    const converter = require('./converters/automation-status')

    testScenarios.forEach(scenario => {
      const points = converter(scenario.data)

      expect(points.length).toBe(1)
      expect(points[0].name).toBe('automation_status')
      expect(points[0].fields.controlMode).toBe(`"${scenario.data.controlMode}"`)
    })
  })
})