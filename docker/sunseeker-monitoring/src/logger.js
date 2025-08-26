/**
 * Logging utilities for Sunseeker MQTT-InfluxDB service
 * Provides standardized logging with emoji prefixes and consistent formatting
 */

import { redactSecret } from './utils.js';

/**
 * Log levels and their corresponding emoji prefixes
 */
const LOG_LEVELS = {
  INFO: '📋',
  SUCCESS: '✅',
  WARNING: '⚠️',
  ERROR: '❌',
  CONNECTION: '📡',
  MESSAGE: '📥',
  WRITE: '📤',
  STOP: '🛑',
  START: '🏠',
  HEALTH: '🩺',
  DATABASE: '💾'
};

/**
 * Create a logger with consistent formatting
 */
class Logger {
  constructor(serviceName = 'Sunseeker Service') {
    this.serviceName = serviceName;
  }

  /**
   * Log informational message
   * @param {string} message - Message to log
   * @param {Object} [data] - Optional data to include
   */
  info(message, data = null) {
    this._log(LOG_LEVELS.INFO, message, data);
  }

  /**
   * Log success message
   * @param {string} message - Success message
   * @param {Object} [data] - Optional data to include
   */
  success(message, data = null) {
    this._log(LOG_LEVELS.SUCCESS, message, data);
  }

  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {Object} [data] - Optional data to include
   */
  warn(message, data = null) {
    this._log(LOG_LEVELS.WARNING, message, data);
  }

  /**
   * Log error message
   * @param {string} message - Error message
   * @param {Error|Object} [error] - Error object or additional data
   */
  error(message, error = null) {
    if (error instanceof Error) {
      console.error(`${LOG_LEVELS.ERROR} ${message}:`, error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      this._log(LOG_LEVELS.ERROR, message, error);
    }
  }

  /**
   * Log connection-related message
   * @param {string} message - Connection message
   * @param {Object} [data] - Optional connection data
   */
  connection(message, data = null) {
    this._log(LOG_LEVELS.CONNECTION, message, data);
  }

  /**
   * Log message processing
   * @param {string} message - Message processing info
   * @param {Object} [data] - Optional message data
   */
  message(message, data = null) {
    this._log(LOG_LEVELS.MESSAGE, message, data);
  }

  /**
   * Log data write operations
   * @param {string} message - Write operation message
   * @param {Object} [data] - Optional write data
   */
  write(message, data = null) {
    this._log(LOG_LEVELS.WRITE, message, data);
  }

  /**
   * Log service start
   * @param {string} message - Start message
   */
  start(message) {
    this._log(LOG_LEVELS.START, message);
  }

  /**
   * Log service stop
   * @param {string} message - Stop message
   */
  stop(message) {
    this._log(LOG_LEVELS.STOP, message);
  }

  /**
   * Log health check information
   * @param {string} message - Health message
   * @param {Object} [data] - Health data
   */
  health(message, data = null) {
    this._log(LOG_LEVELS.HEALTH, message, data);
  }

  /**
   * Log database operations
   * @param {string} message - Database message
   * @param {Object} [data] - Database operation data
   */
  database(message, data = null) {
    this._log(LOG_LEVELS.DATABASE, message, data);
  }

  /**
   * Log configuration with sensitive data redaction
   * @param {Object} config - Configuration object
   */
  logConfig(config) {
    console.log(`${LOG_LEVELS.INFO} Configuration loaded:`);
    console.log(`  MQTT URL: ${config.mqtt.url}`);
    console.log(`  MQTT Username: ${redactSecret(config.mqtt.username)}`);
    console.log(`  MQTT Password: ${redactSecret(config.mqtt.password)}`);
    console.log(`  Device ID: ${config.mqtt.deviceId}`);
    console.log(`  App ID: ${config.mqtt.appId}`);
    console.log(`  InfluxDB URL: ${config.influx.url}`);
    console.log(`  InfluxDB Token: ${redactSecret(config.influx.token)}`);
    console.log(`  InfluxDB Org: ${config.influx.org}`);
    console.log(`  InfluxDB Bucket: ${config.influx.bucket}`);
  }

  /**
   * Internal logging method
   * @private
   */
  _log(level, message, data = null) {
    if (data) {
      console.log(`${level} ${message}`, data);
    } else {
      console.log(`${level} ${message}`);
    }
  }
}

// Create default logger instance
export const logger = new Logger();

// Export Logger class for custom instances
export { Logger };
