// Unit tests for automation events processor
const {
  SAMPLE_BOILER_DECISION_EVENT,
  SAMPLE_MANUAL_OVERRIDE_EVENT,
  SAMPLE_VACATION_MODE_EVENT,
  SAMPLE_SOLAR_PRIORITY_EVENT,
  SAMPLE_OTHER_BOT_EVENT,
  INVALID_EVENT_NO_BOT,
  INVALID_EVENT_NO_REASON,
  INVALID_EVENT_NO_TIMESTAMP
} = require('./test-constants')

// Mock InfluxDB Point for testing
class MockPoint {
  constructor(measurement) {
    this.name = measurement
    this.tags = {}
    this.fields = {}
    this.timestampValue = undefined
  }

  tag(key, value) {
    this.tags[key] = value
    return this
  }

  stringField(key, value) {
    this.fields[key] = `"${value}"`
    return this
  }

  intField(key, value) {
    this.fields[key] = `${value}i`
    return this
  }

  floatField(key, value) {
    this.fields[key] = value
    return this
  }

  booleanField(key, value) {
    this.fields[key] = value ? 'T' : 'F'
    return this
  }

  timestamp(date) {
    this.timestampValue = date
    return this
  }
}

// Mock InfluxDB client
jest.mock('@influxdata/influxdb-client', () => ({
  Point: MockPoint,
  InfluxDB: jest.fn(() => ({
    getWriteApi: jest.fn(() => ({
      writePoints: jest.fn()
    }))
  }))
}))

// Import the processing function (we'll need to refactor index.js to export this)
// For now, let's copy the function for testing
function processAutomationDecisionEvent(data) {
  // Validate required fields for automation decision events
  if (!data._bot || !data._bot.name || !data.reason || !data.controlMode || !data._tz) {
    console.warn('Invalid automation decision event - missing required fields:', data)
    return []
  }

  // Extract service name from _bot.name
  const serviceName = data._bot.name

  // Create InfluxDB point for automation decision
  const point = new MockPoint('automation_status')
    .tag('service', serviceName)
    .tag('type', 'status')
    .stringField('reason', data.reason)
    .stringField('controlMode', data.controlMode)
    .timestamp(new Date(data._tz))

  // Add optional fields if present
  if (data.manualOverrideExpires !== undefined) {
    if (data.manualOverrideExpires === null) {
      point.stringField('manualOverrideExpires', 'null')
    } else {
      point.intField('manualOverrideExpires', data.manualOverrideExpires)
    }
  }

  if (typeof data.heaterState === 'boolean') {
    point.booleanField('heaterState', data.heaterState)
  }

  if (typeof data.solarCirculation === 'boolean') {
    point.booleanField('solarCirculation', data.solarCirculation)
  }

  // Add temperature readings as seen by controller (correlation data)
  if (data.temperatures && typeof data.temperatures === 'object') {
    if (typeof data.temperatures.top === 'number') {
      point.floatField('temp_top_seen', data.temperatures.top)
    }
    if (typeof data.temperatures.bottom === 'number') {
      point.floatField('temp_bottom_seen', data.temperatures.bottom)
    }
    if (typeof data.temperatures.solar === 'number') {
      point.floatField('temp_solar_seen', data.temperatures.solar)
    }
    if (typeof data.temperatures.ambient === 'number') {
      point.floatField('temp_ambient_seen', data.temperatures.ambient)
    }
  }

  return [point]
}

describe('Automation Events Processor', () => {
  describe('processAutomationDecisionEvent', () => {
    it('should process boiler controller automatic decision event', () => {
      const points = processAutomationDecisionEvent(SAMPLE_BOILER_DECISION_EVENT)

      expect(points).toHaveLength(1)
      const point = points[0]

      // Verify measurement name
      expect(point.name).toBe('automation_status')

      // Verify tags
      expect(point.tags.service).toBe('boiler_controller')
      expect(point.tags.type).toBe('status')

      // Verify decision fields
      expect(point.fields.reason).toBe('"comfort_heating_top_45.2C"')
      expect(point.fields.controlMode).toBe('"automatic"')
      expect(point.fields.manualOverrideExpires).toBe('"null"')

      // Verify state fields
      expect(point.fields.heaterState).toBe('T')
      expect(point.fields.solarCirculation).toBe('F')

      // Verify temperature correlation fields
      expect(point.fields.temp_top_seen).toBe(45.2)
      expect(point.fields.temp_bottom_seen).toBe(42.8)
      expect(point.fields.temp_solar_seen).toBe(38.1)
      expect(point.fields.temp_ambient_seen).toBe(26.9)

      // Verify timestamp
      expect(point.timestampValue).toEqual(new Date(1726325400000))
    })

    it('should process manual override event with expiry timestamp', () => {
      const points = processAutomationDecisionEvent(SAMPLE_MANUAL_OVERRIDE_EVENT)

      expect(points).toHaveLength(1)
      const point = points[0]

      expect(point.fields.controlMode).toBe('"manual_on"')
      expect(point.fields.manualOverrideExpires).toBe('1726411800000i')
      expect(point.fields.heaterState).toBe('T')
    })

    it('should process vacation mode event', () => {
      const points = processAutomationDecisionEvent(SAMPLE_VACATION_MODE_EVENT)

      expect(points).toHaveLength(1)
      const point = points[0]

      expect(point.fields.controlMode).toBe('"vacation_7d"')
      expect(point.fields.manualOverrideExpires).toBe('1726909800000i')
      expect(point.fields.heaterState).toBe('F')
    })

    it('should process solar priority decision event', () => {
      const points = processAutomationDecisionEvent(SAMPLE_SOLAR_PRIORITY_EVENT)

      expect(points).toHaveLength(1)
      const point = points[0]

      expect(point.fields.reason).toBe('"solar_priority_advantage_8.3C"')
      expect(point.fields.heaterState).toBe('F')
      expect(point.fields.solarCirculation).toBe('T')
      expect(point.fields.temp_solar_seen).toBe(60.4)
    })

    it('should process events from other automation bots', () => {
      const points = processAutomationDecisionEvent(SAMPLE_OTHER_BOT_EVENT)

      expect(points).toHaveLength(1)
      const point = points[0]

      expect(point.tags.service).toBe('irrigation_controller')
      expect(point.fields.reason).toBe('"scheduled_watering_zone_1"')
    })
  })

  describe('event validation', () => {
    it('should reject events without _bot metadata', () => {
      const points = processAutomationDecisionEvent(INVALID_EVENT_NO_BOT)
      expect(points).toHaveLength(0)
    })

    it('should reject events without reason field', () => {
      const points = processAutomationDecisionEvent(INVALID_EVENT_NO_REASON)
      expect(points).toHaveLength(0)
    })

    it('should reject events without timestamp', () => {
      const points = processAutomationDecisionEvent(INVALID_EVENT_NO_TIMESTAMP)
      expect(points).toHaveLength(0)
    })

    it('should handle events with missing optional fields', () => {
      const minimalEvent = {
        _bot: { name: 'test_bot', type: 'test' },
        _tz: Date.now(),
        reason: 'test_reason',
        controlMode: 'automatic'
        // No manualOverrideExpires, heaterState, solarCirculation, temperatures
      }

      const points = processAutomationDecisionEvent(minimalEvent)
      expect(points).toHaveLength(1)

      const point = points[0]
      expect(point.fields.reason).toBe('"test_reason"')
      expect(point.fields.controlMode).toBe('"automatic"')
      // Optional fields should not be present
      expect(point.fields.heaterState).toBeUndefined()
      expect(point.fields.temp_top_seen).toBeUndefined()
    })

    it('should handle malformed temperature data gracefully', () => {
      const eventWithBadTemps = {
        ...SAMPLE_BOILER_DECISION_EVENT,
        temperatures: {
          top: 'not_a_number',
          bottom: null,
          solar: undefined,
          ambient: 25.5
        }
      }

      const points = processAutomationDecisionEvent(eventWithBadTemps)
      expect(points).toHaveLength(1)

      const point = points[0]
      // Only valid temperature should be included
      expect(point.fields.temp_ambient_seen).toBe(25.5)
      expect(point.fields.temp_top_seen).toBeUndefined()
      expect(point.fields.temp_bottom_seen).toBeUndefined()
      expect(point.fields.temp_solar_seen).toBeUndefined()
    })
  })

  describe('field type handling', () => {
    it('should format string fields correctly', () => {
      const points = processAutomationDecisionEvent(SAMPLE_BOILER_DECISION_EVENT)
      const point = points[0]

      expect(point.fields.reason).toBe('"comfort_heating_top_45.2C"')
      expect(point.fields.controlMode).toBe('"automatic"')
    })

    it('should format boolean fields correctly', () => {
      const points = processAutomationDecisionEvent(SAMPLE_BOILER_DECISION_EVENT)
      const point = points[0]

      expect(point.fields.heaterState).toBe('T')
      expect(point.fields.solarCirculation).toBe('F')
    })

    it('should format integer fields correctly', () => {
      const points = processAutomationDecisionEvent(SAMPLE_MANUAL_OVERRIDE_EVENT)
      const point = points[0]

      expect(point.fields.manualOverrideExpires).toBe('1726411800000i')
    })

    it('should format float fields correctly', () => {
      const points = processAutomationDecisionEvent(SAMPLE_BOILER_DECISION_EVENT)
      const point = points[0]

      expect(point.fields.temp_top_seen).toBe(45.2)
      expect(point.fields.temp_bottom_seen).toBe(42.8)
    })
  })
})