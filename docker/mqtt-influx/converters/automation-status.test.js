// Test-Driven Development for automation-status converter
// Red-Green-Refactor cycle implementation

const automationStatusConverter = require('./automation-status')
const {
  SAMPLE_BOILER_CONTROLLER_STATUS,
  SAMPLE_MANUAL_MODE_STATUS,
  SAMPLE_VACATION_MODE_STATUS,
  SAMPLE_SOLAR_PRIORITY_STATUS,
  EXPECTED_TAGS,
  EXPECTED_MEASUREMENT_NAME
} = require('../test-constants')

describe('automation-status converter', () => {
  describe('basic conversion functionality', () => {
    it('should return an array of InfluxDB points', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should create points with correct measurement name', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)

      expect(result[0].name).toBe(EXPECTED_MEASUREMENT_NAME)
    })

    it('should add correct service tags', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      expect(point.tags).toEqual(expect.objectContaining(EXPECTED_TAGS))
    })

    it('should use timestamp from _tz field', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      expect(point.time).toBe(SAMPLE_BOILER_CONTROLLER_STATUS._tz)
    })
  })

  describe('controller decision fields (source of truth)', () => {
    it('should store reason as string field', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      expect(point.fields.reason).toBe('"comfort_heating_top_45.2C"')
    })

    it('should store controlMode as string field', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      expect(point.fields.controlMode).toBe('"automatic"')
    })

    it('should store manualOverrideExpires as integer field when present', () => {
      const result = automationStatusConverter(SAMPLE_MANUAL_MODE_STATUS)
      const point = result[0]

      expect(point.fields.manualOverrideExpires).toBe('1726411800000i')
    })

    it('should handle null manualOverrideExpires gracefully', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      // Should not include null values in fields
      expect('manualOverrideExpires' in point.fields).toBe(false)
    })
  })

  describe('controller view fields (for correlation)', () => {
    it('should store heaterState as boolean field', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      expect(point.fields.heaterState).toBe('T')
    })

    it('should store solarCirculation as boolean field', () => {
      const result = automationStatusConverter(SAMPLE_SOLAR_PRIORITY_STATUS)
      const point = result[0]

      expect(point.fields.solarCirculation).toBe('T')
    })

    it('should store temperature readings with _seen suffix', () => {
      const result = automationStatusConverter(SAMPLE_BOILER_CONTROLLER_STATUS)
      const point = result[0]

      expect(point.fields.temp_top_seen).toBe('45.2')
      expect(point.fields.temp_bottom_seen).toBe('42.8')
      expect(point.fields.temp_solar_seen).toBe('38.1')
      expect(point.fields.temp_ambient_seen).toBe('26.9')
    })
  })

  describe('different control modes', () => {
    it('should handle manual_on mode correctly', () => {
      const result = automationStatusConverter(SAMPLE_MANUAL_MODE_STATUS)
      const point = result[0]

      expect(point.fields.controlMode).toBe('"manual_on"')
      expect(point.fields.reason).toContain('manual_on')
      expect(point.fields.manualOverrideExpires).toBe('1726411800000i')
    })

    it('should handle vacation mode correctly', () => {
      const result = automationStatusConverter(SAMPLE_VACATION_MODE_STATUS)
      const point = result[0]

      expect(point.fields.controlMode).toBe('"vacation_7d"')
      expect(point.fields.reason).toContain('vacation_7d')
      expect(point.fields.heaterState).toBe('F')
    })

    it('should handle solar priority mode correctly', () => {
      const result = automationStatusConverter(SAMPLE_SOLAR_PRIORITY_STATUS)
      const point = result[0]

      expect(point.fields.reason).toContain('solar_priority_advantage')
      expect(point.fields.solarCirculation).toBe('T')
      expect(point.fields.heaterState).toBe('F')
    })
  })

  describe('error handling', () => {
    it('should return empty array for malformed input', () => {
      const result = automationStatusConverter({})

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('should return empty array for null input', () => {
      const result = automationStatusConverter(null)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('should return empty array for undefined input', () => {
      const result = automationStatusConverter(undefined)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })
  })

  describe('data quality validation', () => {
    it('should require reason field to create point', () => {
      const incompleteData = { ...SAMPLE_BOILER_CONTROLLER_STATUS }
      delete incompleteData.reason

      const result = automationStatusConverter(incompleteData)

      expect(result.length).toBe(0)
    })

    it('should require controlMode field to create point', () => {
      const incompleteData = { ...SAMPLE_BOILER_CONTROLLER_STATUS }
      delete incompleteData.controlMode

      const result = automationStatusConverter(incompleteData)

      expect(result.length).toBe(0)
    })

    it('should require _tz timestamp field to create point', () => {
      const incompleteData = { ...SAMPLE_BOILER_CONTROLLER_STATUS }
      delete incompleteData._tz

      const result = automationStatusConverter(incompleteData)

      expect(result.length).toBe(0)
    })
  })
})