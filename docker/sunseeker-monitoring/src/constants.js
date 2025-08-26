/**
 * Constants for Sunseeker MQTT-InfluxDB service
 * Centralized configuration values to eliminate magic numbers and strings
 */

// Health check and monitoring constants
export const HEALTH_CHECK = {
  /** Maximum time without messages before considering service degraded (5 minutes) */
  RECENT_ACTIVITY_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes

  /** Health status values */
  STATUS: {
    HEALTHY: 'healthy',
    UNHEALTHY: 'unhealthy',
    DEGRADED: 'degraded'
  }
};

// Temperature monitoring constants
export const TEMPERATURE = {
  /** High temperature alert threshold (celsius) */
  HIGH_THRESHOLD: 40,

  /** Low temperature alert threshold (celsius) */
  LOW_THRESHOLD: 10,

  /** Temperature alert levels */
  ALERTS: {
    HIGH: 'high',
    NORMAL: 'normal',
    LOW: 'low'
  }
};

// MQTT connection constants
export const MQTT = {
  /** Default MQTT reconnection period (milliseconds) */
  RECONNECT_PERIOD_MS: 1000,

  /** Default MQTT connection timeout (milliseconds) */
  CONNECT_TIMEOUT_MS: 30 * 1000, // 30 seconds

  /** Client ID prefix for random generation */
  CLIENT_ID_PREFIX: 'sunseeker-mqtt-influx-'
};

// Sunseeker device mode mappings
export const SUNSEEKER_MODES = {
  0: 'Standby',
  1: 'Mowing',
  2: 'Going Home',
  3: 'Charging',
  7: 'Departing'
};

// InfluxDB measurement names
export const MEASUREMENTS = {
  MODE: 'sunseeker_mode',
  POWER: 'sunseeker_power',
  STATION: 'sunseeker_station',
  CONNECTION: 'sunseeker_connection',
  BATTERY_DETAIL: 'sunseeker_battery_detail',
  BATTERY_INFO: 'sunseeker_battery_info',
  STATE_CHANGE: 'sunseeker_state_change',
  COMMANDS: 'sunseeker_commands'
};

// Message command types
export const COMMAND_TYPES = {
  STATUS_UPDATE: 501,
  LOG_MESSAGE: 509,
  STATE_CHANGE: 511,
  BATTERY_INFO: 512,
  COMMAND_ACK: 400
};

// Default configuration values
export const DEFAULTS = {
  MQTT: {
    URL: 'mqtt://mqtts.sk-robot.com:1883',
    USERNAME: 'app'
  },
  INFLUX: {
    URL: 'http://influxdb:8086',
    ORG: '',
    BUCKET: 'sunseeker'
  }
};
