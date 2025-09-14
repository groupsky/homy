// Integration test for automation-status converter with main service
const { SAMPLE_BOILER_CONTROLLER_STATUS } = require('./test-constants')

describe('automation-status integration', () => {
  let converters

  beforeAll(() => {
    // Import converters exactly as index.js does
    converters = {
      dds024mr: require('./converters/dds024mr'),
      dds519mr: require('./converters/dds519mr'),
      ex9em: require('./converters/ex9em'),
      'or-we-514': require('./converters/or-we-514'),
      sdm630: require('./converters/sdm630'),
      'automation-status': require('./converters/automation-status'),
    }
  })

  it('should be registered in converters object', () => {
    expect('automation-status' in converters).toBe(true)
    expect(typeof converters['automation-status']).toBe('function')
  })

  it('should process MQTT message as main service would', () => {
    // Simulate how index.js processes messages
    const data = {
      ...SAMPLE_BOILER_CONTROLLER_STATUS,
      _type: 'automation-status'  // This would be added by the publishing service
    }

    // Check converter lookup logic
    expect(data._type in converters).toBe(true)

    // Process message as main service would
    const points = converters[data._type](data)

    expect(Array.isArray(points)).toBe(true)
    expect(points.length).toBe(1)
    expect(points[0].name).toBe('automation_status')
  })

  it('should handle message format from boiler controller framework', () => {
    // Test with the exact format that comes from the boiler controller
    const mqttMessage = {
      // Controller decisions (source of truth)
      reason: 'comfort_heating_top_45.2C',
      controlMode: 'automatic',
      manualOverrideExpires: null,

      // Controller view for correlation
      heaterState: true,
      solarCirculation: false,
      temperatures: {
        top: 45.2,
        bottom: 42.8,
        solar: 38.1,
        ambient: 26.9
      },

      // Framework metadata (added by automations framework)
      _bot: {
        name: 'boiler_controller',
        type: 'boiler-controller'
      },
      _tz: Date.now(),
      _type: 'automation-status'  // Added by mqtt-influx service configuration
    }

    const points = converters[mqttMessage._type](mqttMessage)

    expect(points.length).toBe(1)

    const point = points[0]
    expect(point.name).toBe('automation_status')
    expect(point.tags.service).toBe('boiler_controller')
    expect(point.tags.type).toBe('status')
    expect(point.fields.reason).toBe('"comfort_heating_top_45.2C"')
    expect(point.fields.controlMode).toBe('"automatic"')
    expect(point.fields.heaterState).toBe('T')
  })
})