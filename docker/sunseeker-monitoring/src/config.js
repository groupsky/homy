/**
 * Configuration loader for Sunseeker MQTT-InfluxDB service
 * Supports environment variables and Docker secrets pattern
 */

import { loadSecret, validateConfig } from './utils.js';
import { DEFAULTS } from './constants.js';
import { logger } from './logger.js';

/**
 * Configuration validation schema
 * Maps configuration paths to human-readable descriptions
 */
const CONFIG_SCHEMA = {
  'mqtt.password': 'MQTT_PASSWORD',
  'mqtt.deviceId': 'MQTT_DEVICE_ID',
  'mqtt.appId': 'MQTT_APP_ID',
  'influx.token': 'INFLUXDB_TOKEN, or INFLUXDB_USERNAME/INFLUXDB_PASSWORD'
};

/**
 * Load and validate configuration
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  // MQTT Configuration
  const mqttUrl = process.env.MQTT_URL || DEFAULTS.MQTT.URL;
  const mqttUsername = process.env.MQTT_USERNAME || DEFAULTS.MQTT.USERNAME;
  const mqttPassword = loadSecret('MQTT_PASSWORD');
  const deviceId = process.env.MQTT_DEVICE_ID;
  const appId = process.env.MQTT_APP_ID;

  // InfluxDB Configuration
  const influxUrl = process.env.INFLUXDB_URL || DEFAULTS.INFLUX.URL;
  const influxToken = loadSecret('INFLUXDB_TOKEN') || `${loadSecret('INFLUXDB_USERNAME')}:${loadSecret('INFLUXDB_PASSWORD')}`;
  const influxOrg = process.env.INFLUXDB_ORG || DEFAULTS.INFLUX.ORG;
  const influxBucket = process.env.INFLUXDB_BUCKET || (process.env.INFLUXDB_DATABASE ? `${process.env.INFLUXDB_DATABASE}/${process.env.INFLUXDB_RP || 'autogen'}` : DEFAULTS.INFLUX.BUCKET);

  const config = {
    mqtt: {
      url: mqttUrl,
      username: mqttUsername,
      password: mqttPassword,
      deviceId: deviceId,
      appId: appId
    },
    influx: {
      url: influxUrl,
      token: influxToken,
      org: influxOrg,
      bucket: influxBucket
    }
  };

  // Validate required fields using utility function
  validateConfig(config, CONFIG_SCHEMA);

  // Log configuration with sensitive data redaction
  logger.logConfig(config);

  return config;
}
