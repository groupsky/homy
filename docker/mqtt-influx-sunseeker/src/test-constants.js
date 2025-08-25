/**
 * Test constants for Sunseeker MQTT-InfluxDB service tests
 * Contains placeholder values that should be used in all tests
 */

// Test device and service identifiers
export const TEST_DEVICE_ID = 'test-device-123456789';
export const TEST_APP_ID = 'test-app-987654321';

// Test MQTT configuration
export const TEST_MQTT_CONFIG = {
  url: 'mqtts://test-mqtt.example.com:8883',
  username: 'test-user',
  password: 'test-password-12345',
  deviceId: TEST_DEVICE_ID,
  appId: TEST_APP_ID
};

// Test InfluxDB configuration
export const TEST_INFLUX_CONFIG = {
  url: 'http://test-influxdb:8086',
  token: 'test-influx-token-12345',
  org: 'test-org',
  bucket: 'test-bucket'
};

// Test MQTT topics
export const TEST_TOPICS = {
  DEVICE_UPDATE: `/device/${TEST_DEVICE_ID}/update`,
  DEVICE_GET: `/device/${TEST_DEVICE_ID}/get`,
  APP_GET: `/app/${TEST_APP_ID}/get`
};

// Test message payloads
export const TEST_MESSAGES = {
  STATUS_UPDATE: {
    cmd: 501,
    mode: 3,
    power: 96,
    station: true
  },
  LOG_MESSAGE: {
    cmd: 509,
    lv: 3,
    log: 'I/charging [Sun Aug 24 22:58:16 2025] (637)bat vol=18500,min=3700mV,max=3750mV,temp=25,current=1200,percent=85,lstr=0,rstr=0,pitch=180,roll=0,heading=90\\n'
  },
  STATE_CHANGE: {
    cmd: 511,
    time: 1756076015,
    msg: 1
  },
  BATTERY_INFO: {
    cmd: 512,
    bat_type: '5S1P_TEST_BATTERY',
    bat_id: 123456789,
    bat_ctimes: 93,
    bat_dtimes: 93
  },
  COMMAND_ACK: {
    cmd: 400,
    command: 101,
    result: true
  },
  APP_MESSAGE: {
    mode: 3,
    station: true,
    cmd: 501,
    power: 96,
    deviceSn: TEST_DEVICE_ID
  }
};