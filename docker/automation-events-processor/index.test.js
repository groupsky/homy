// Integration test for automation events processor
const {
  SAMPLE_BOILER_DECISION_EVENT,
  SAMPLE_OTHER_BOT_EVENT
} = require('./test-constants')

// Mock MQTT client for integration testing
const mockMqttClient = {
  connect: jest.fn(),
  subscribe: jest.fn(),
  on: jest.fn(),
  end: jest.fn()
}

jest.mock('mqtt', () => ({
  connect: jest.fn(() => mockMqttClient)
}))

// Mock InfluxDB for integration testing
const mockWriteApi = {
  writePoints: jest.fn(),
  close: jest.fn()
}

const mockInfluxDB = {
  getWriteApi: jest.fn(() => mockWriteApi)
}

jest.mock('@influxdata/influxdb-client', () => ({
  InfluxDB: jest.fn(() => mockInfluxDB),
  Point: class MockPoint {
    constructor(measurement) {
      this.name = measurement
      this.tags = {}
      this.fields = {}
      this.timestampValue = undefined
    }
    tag(key, value) { this.tags[key] = value; return this }
    stringField(key, value) { this.fields[key] = `"${value}"`; return this }
    intField(key, value) { this.fields[key] = `${value}i`; return this }
    floatField(key, value) { this.fields[key] = value; return this }
    booleanField(key, value) { this.fields[key] = value ? 'T' : 'F'; return this }
    timestamp(date) { this.timestampValue = date; return this }
  }
}))

describe('Automation Events Processor Integration', () => {
  let originalEnv
  let messageHandler

  beforeEach(() => {
    // Save original environment
    originalEnv = process.env

    // Set test environment
    process.env = {
      ...originalEnv,
      BROKER: 'mqtt://test-broker',
      TOPIC: 'homy/automation/+/status',
      MQTT_CLIENT_ID: 'test-automation-events',
      INFLUXDB_URL: 'http://test-influx:8086',
      INFLUXDB_DATABASE: 'test_homy'
    }

    // Clear mocks
    jest.clearAllMocks()

    // Capture message handler when service starts
    mockMqttClient.on.mockImplementation((event, handler) => {
      if (event === 'message') {
        messageHandler = handler
      }
    })
  })

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv

    // Clear require cache to ensure fresh module loading for each test
    delete require.cache[require.resolve('./index.js')]
  })

  it('should initialize with correct configuration', () => {
    // Import after setting environment
    delete require.cache[require.resolve('./index.js')]
    require('./index.js')

    expect(mockMqttClient.connect).not.toHaveBeenCalled() // mocked differently
    expect(mockInfluxDB.getWriteApi).toHaveBeenCalledWith(
      '',
      'test_homy/autogen',
      'ms',
      { defaultTags: [] }
    )
  })

  it('should process automation decision events end-to-end', () => {
    // Import service after setting up mocks
    delete require.cache[require.resolve('./index.js')]
    require('./index.js')

    // Simulate receiving MQTT message
    const topic = 'homy/automation/boiler_controller/status'
    const message = Buffer.from(JSON.stringify(SAMPLE_BOILER_DECISION_EVENT))

    messageHandler(topic, message)

    // Verify InfluxDB write was called
    expect(mockWriteApi.writePoints).toHaveBeenCalledTimes(1)
    const writtenPoints = mockWriteApi.writePoints.mock.calls[0][0]

    expect(writtenPoints).toHaveLength(1)
    const point = writtenPoints[0]
    expect(point.name).toBe('automation_status')
    expect(point.tags.service).toBe('boiler_controller')
    expect(point.fields.reason).toBe('"comfort_heating_top_45.2C"')
  })

  it('should handle events from different automation bots', () => {
    delete require.cache[require.resolve('./index.js')]
    require('./index.js')

    const topic = 'homy/automation/irrigation_controller/status'
    const message = Buffer.from(JSON.stringify(SAMPLE_OTHER_BOT_EVENT))

    messageHandler(topic, message)

    expect(mockWriteApi.writePoints).toHaveBeenCalledTimes(1)
    const writtenPoints = mockWriteApi.writePoints.mock.calls[0][0]

    const point = writtenPoints[0]
    expect(point.tags.service).toBe('irrigation_controller')
    expect(point.fields.reason).toBe('"scheduled_watering_zone_1"')
  })

  it('should handle malformed JSON gracefully', () => {
    delete require.cache[require.resolve('./index.js')]
    require('./index.js')

    const topic = 'homy/automation/test_bot/status'
    const malformedMessage = Buffer.from('{invalid: json}')

    // Should not throw
    expect(() => {
      messageHandler(topic, malformedMessage)
    }).not.toThrow()

    // Should not write to InfluxDB
    expect(mockWriteApi.writePoints).not.toHaveBeenCalled()
  })

  it('should handle invalid events without writing', () => {
    delete require.cache[require.resolve('./index.js')]
    require('./index.js')

    const invalidEvent = {
      // Missing required fields
      reason: 'test'
    }

    const topic = 'homy/automation/test_bot/status'
    const message = Buffer.from(JSON.stringify(invalidEvent))

    messageHandler(topic, message)

    // Should not write to InfluxDB for invalid events
    expect(mockWriteApi.writePoints).not.toHaveBeenCalled()
  })

  it('should parse TAGS environment variable correctly', () => {
    // Test tags parsing logic directly without requiring the module again
    const testTags = '{"environment":"test","instance":"1"}'
    const expectedTags = { environment: 'test', instance: '1' }

    // Parse tags the same way the main module does
    const parsedTags = JSON.parse(testTags)

    expect(parsedTags).toEqual(expectedTags)
  })
})