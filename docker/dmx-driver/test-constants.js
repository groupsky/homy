/**
 * Test constants for dmx-driver tests
 * Never use real device IDs, MQTT brokers, or sensitive data
 */

module.exports = {
  MQTT: {
    BROKER_URL: 'mqtt://test-broker:1883',
    CLIENT_ID: 'test-dmx-driver-client',
    TOPIC: 'test/arduino/mega/state'
  },
  DMX: {
    DEVICE_ID: 0,
    DEFAULT_CHANNELS: [0, 0, 0, 0]
  },
  TEST_MESSAGES: {
    VALID_INPUT: {
      inputs: 2580 // Binary: 101000010100 (bits 2, 5, 9, 11)
    },
    ZERO_INPUT: {
      inputs: 0
    },
    MAX_INPUT: {
      inputs: 4095 // All 12 bits set
    }
  }
}
