// Test constants for automation events processor
// Realistic test data following event sourcing principles

const SAMPLE_BOILER_DECISION_EVENT = {
  // Event metadata (added by automation framework)
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000, // 2025-09-14T19:30:00Z

  // Decision event data (source of truth)
  reason: 'comfort_heating_insufficient',
  controlMode: 'automatic',
  manualOverrideExpires: null,

  // Controller state at decision time (correlation data)
  heaterState: true,
  solarCirculation: false,
  temperatures: {
    top: 45.2,
    bottom: 42.8,
    solar: 38.1,
    ambient: 26.9
  }
}

const SAMPLE_MANUAL_OVERRIDE_EVENT = {
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000,

  reason: 'manual_on (expires: Fri Sep 15 2025 19:30:00 GMT+0300)',
  controlMode: 'manual_on',
  manualOverrideExpires: 1726411800000, // 24 hours later

  heaterState: true,
  solarCirculation: false,
  temperatures: {
    top: 55.0,
    bottom: 52.3,
    solar: 34.6,
    ambient: 27.2
  }
}

const SAMPLE_VACATION_MODE_EVENT = {
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000,

  reason: 'vacation_7d (expires: Thu Sep 21 2025 13:30:00 GMT+0300)',
  controlMode: 'vacation_7d',
  manualOverrideExpires: 1726909800000, // 7 days - 6 hours later

  heaterState: false,
  solarCirculation: false,
  temperatures: {
    top: 40.1,
    bottom: 38.7,
    solar: 41.2,
    ambient: 25.8
  }
}

const SAMPLE_SOLAR_PRIORITY_EVENT = {
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000,

  reason: 'solar_priority_available',
  controlMode: 'automatic',
  manualOverrideExpires: null,

  heaterState: false,
  solarCirculation: true,
  temperatures: {
    top: 52.1,
    bottom: 50.7,
    solar: 60.4, // Solar advantage = 60.4 - 52.1 = 8.3°C
    ambient: 28.1
  }
}

const SAMPLE_OTHER_BOT_EVENT = {
  _bot: {
    name: 'irrigation_controller',
    type: 'irrigation-controller'
  },
  _tz: 1726325400000,

  reason: 'scheduled_watering_zone_1',
  controlMode: 'automatic',
  manualOverrideExpires: null,

  valveState: true,
  duration: 1800000, // 30 minutes
  zone: 1
}

// Invalid events for error testing
const INVALID_EVENT_NO_BOT = {
  reason: 'some_reason',
  controlMode: 'automatic'
}

const INVALID_EVENT_NO_REASON = {
  _bot: { name: 'test_bot', type: 'test' },
  _tz: Date.now(),
  controlMode: 'automatic'
}

const INVALID_EVENT_NO_TIMESTAMP = {
  _bot: { name: 'test_bot', type: 'test' },
  reason: 'some_reason',
  controlMode: 'automatic'
}

module.exports = {
  SAMPLE_BOILER_DECISION_EVENT,
  SAMPLE_MANUAL_OVERRIDE_EVENT,
  SAMPLE_VACATION_MODE_EVENT,
  SAMPLE_SOLAR_PRIORITY_EVENT,
  SAMPLE_OTHER_BOT_EVENT,
  INVALID_EVENT_NO_BOT,
  INVALID_EVENT_NO_REASON,
  INVALID_EVENT_NO_TIMESTAMP
}