// Test constants for mqtt-influx automation status converter
// Following TDD best practices - realistic test data without real sensitive values

const SAMPLE_BOILER_CONTROLLER_STATUS = {
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

  // Framework-added metadata
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000 // 2025-09-14T19:30:00Z
}

const SAMPLE_MANUAL_MODE_STATUS = {
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
  },
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000
}

const SAMPLE_VACATION_MODE_STATUS = {
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
  },
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000
}

const SAMPLE_SOLAR_PRIORITY_STATUS = {
  reason: 'solar_priority_advantage_8.3C',
  controlMode: 'automatic',
  manualOverrideExpires: null,
  heaterState: false,
  solarCirculation: true,
  temperatures: {
    top: 52.1,
    bottom: 50.7,
    solar: 60.4, // Solar advantage = 60.4 - 52.1 = 8.3°C
    ambient: 28.1
  },
  _bot: {
    name: 'boiler_controller',
    type: 'boiler-controller'
  },
  _tz: 1726325400000
}

const EXPECTED_TAGS = {
  service: 'boiler_controller',
  type: 'status'
}

const EXPECTED_MEASUREMENT_NAME = 'automation_status'

module.exports = {
  SAMPLE_BOILER_CONTROLLER_STATUS,
  SAMPLE_MANUAL_MODE_STATUS,
  SAMPLE_VACATION_MODE_STATUS,
  SAMPLE_SOLAR_PRIORITY_STATUS,
  EXPECTED_TAGS,
  EXPECTED_MEASUREMENT_NAME
}