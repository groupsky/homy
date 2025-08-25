/**
 * Sunseeker lawn mower MQTT message parser
 * Converts MQTT messages to InfluxDB data points
 */

import { SUNSEEKER_MODES, TEMPERATURE, MEASUREMENTS, COMMAND_TYPES } from './constants.js';
import { safeJsonParse, extractDeviceIdFromTopic } from './utils.js';
import { logger } from './logger.js';

export class SunseekerMessageParser {
  constructor() {
    this.modeMapping = SUNSEEKER_MODES;
  }

  /**
   * Parse MQTT message and convert to InfluxDB data points
   * @param {string} topic - MQTT topic
   * @param {string} payload - JSON payload
   * @returns {Array<Object>|null} Array of data points or null if invalid
   */
  parseMessage(topic, payload) {
    const data = safeJsonParse(payload, 'MQTT message');
    if (!data) return null;

    const deviceId = extractDeviceIdFromTopic(topic) || data.deviceSn;
    
    if (!deviceId) {
      logger.warn('No device ID found in topic or payload');
      return null;
    }

    return this._parseByCommand(data, deviceId);
  }

  /**
   * Parse message based on command type
   * @private
   */
  _parseByCommand(data, deviceId) {
    const cmd = data.cmd;
    
    switch (cmd) {
      case COMMAND_TYPES.STATUS_UPDATE:
        return this._parseStatusMessage(data, deviceId);
      case COMMAND_TYPES.LOG_MESSAGE:
        return this._parseLogMessage(data, deviceId);
      case COMMAND_TYPES.STATE_CHANGE:
        return this._parseStateChangeMessage(data, deviceId);
      case COMMAND_TYPES.BATTERY_INFO:
        return this._parseBatteryInfoMessage(data, deviceId);
      case COMMAND_TYPES.COMMAND_ACK:
        return this._parseCommandAckMessage(data, deviceId);
      default:
        logger.warn(`Unsupported command type: ${cmd}`);
        return null;
    }
  }

  /**
   * Parse cmd 501 - status updates
   * @private
   */
  _parseStatusMessage(data, deviceId) {
    const points = [];
    const timestamp = new Date();

    // Mode data point
    if ('mode' in data) {
      points.push({
        measurement: MEASUREMENTS.MODE,
        device_id: deviceId,
        fields: {
          mode: data.mode,
          mode_text: this.modeMapping[data.mode] || 'Unknown'
        },
        tags: {},
        timestamp
      });
    }

    // Power data point
    if ('power' in data) {
      points.push({
        measurement: MEASUREMENTS.POWER,
        device_id: deviceId,
        fields: {
          battery_percentage: data.power
        },
        tags: {},
        timestamp
      });
    }

    // Station data point
    if ('station' in data) {
      points.push({
        measurement: MEASUREMENTS.STATION,
        device_id: deviceId,
        fields: {
          at_station: data.station
        },
        tags: {},
        timestamp
      });
    }

    // Connection health point
    points.push({
      measurement: MEASUREMENTS.CONNECTION,
      device_id: deviceId,
      fields: {
        connected: true
      },
      tags: {},
      timestamp
    });

    return points;
  }

  /**
   * Parse cmd 509 - log messages
   * @private
   */
  _parseLogMessage(data, deviceId) {
    if (!data.log) return [];

    const logData = this._extractLogData(data.log);
    if (Object.keys(logData).length === 0) return [];

    const timestamp = new Date();
    const tags = {};

    // Add temperature alert tags
    if ('temperature' in logData) {
      if (logData.temperature >= TEMPERATURE.HIGH_THRESHOLD) {
        tags.temp_alert = TEMPERATURE.ALERTS.HIGH;
      } else if (logData.temperature <= TEMPERATURE.LOW_THRESHOLD) {
        tags.temp_alert = TEMPERATURE.ALERTS.LOW;
      } else {
        tags.temp_alert = TEMPERATURE.ALERTS.NORMAL;
      }
    }

    return [{
      measurement: MEASUREMENTS.BATTERY_DETAIL,
      device_id: deviceId,
      fields: logData,
      tags,
      timestamp
    }];
  }

  /**
   * Parse cmd 511 - state change messages
   * @private
   */
  _parseStateChangeMessage(data, deviceId) {
    const timestamp = new Date();

    return [{
      measurement: MEASUREMENTS.STATE_CHANGE,
      device_id: deviceId,
      fields: {
        message_code: data.msg,
        timestamp: data.time
      },
      tags: {},
      timestamp
    }];
  }

  /**
   * Parse cmd 512 - battery info messages
   * @private
   */
  _parseBatteryInfoMessage(data, deviceId) {
    const timestamp = new Date();
    const points = [];

    // Main battery info point
    const fields = {};
    
    if ('bat_dtimes' in data) {
      fields.discharge_times = data.bat_dtimes;
    }
    
    if ('bat_type' in data) {
      fields.battery_type = data.bat_type;
    }
    
    if ('bat_ctimes' in data) {
      fields.charge_times = data.bat_ctimes;
    }
    
    if ('bat_id' in data) {
      fields.battery_id = data.bat_id;
    }

    if (Object.keys(fields).length > 0) {
      points.push({
        measurement: MEASUREMENTS.BATTERY_INFO,
        device_id: deviceId,
        fields,
        tags: {},
        timestamp
      });
    }

    return points;
  }

  /**
   * Parse cmd 400 - command acknowledgments
   * @private
   */
  _parseCommandAckMessage(data, deviceId) {
    const timestamp = new Date();

    return [{
      measurement: MEASUREMENTS.COMMANDS,
      device_id: deviceId,
      fields: {
        command: data.command,
        result: data.result
      },
      tags: {},
      timestamp
    }];
  }


  /**
   * Extract structured data from log messages
   * @private
   */
  _extractLogData(logText) {
    const data = {};

    // Extract battery voltage
    const volMatch = logText.match(/bat vol=(\d+)(?:mV)?/);
    if (volMatch) {
      data.voltage_mv = parseInt(volMatch[1], 10);
    }

    // Extract percentage
    const percentMatch = logText.match(/percent=(\d+)/);
    if (percentMatch) {
      data.percentage = parseInt(percentMatch[1], 10);
    }

    // Extract min cell voltage
    const minMatch = logText.match(/min=(\d+)mV/);
    if (minMatch) {
      data.min_cell_mv = parseInt(minMatch[1], 10);
    }

    // Extract max cell voltage
    const maxMatch = logText.match(/max=(\d+)mV/);
    if (maxMatch) {
      data.max_cell_mv = parseInt(maxMatch[1], 10);
    }

    // Extract temperature
    const tempMatch = logText.match(/temp=(\d+)/);
    if (tempMatch) {
      data.temperature = parseInt(tempMatch[1], 10);
    }

    // Extract current
    const currentMatch = logText.match(/current=(\d+)/);
    if (currentMatch) {
      data.current_ma = parseInt(currentMatch[1], 10);
    }

    // Extract pitch
    const pitchMatch = logText.match(/pitch=(\d+)/);
    if (pitchMatch) {
      data.pitch = parseInt(pitchMatch[1], 10);
    }

    // Extract roll
    const rollMatch = logText.match(/roll=(\d+)/);
    if (rollMatch) {
      data.roll = parseInt(rollMatch[1], 10);
    }

    // Extract heading
    const headingMatch = logText.match(/heading=(\d+)/);
    if (headingMatch) {
      data.heading = parseInt(headingMatch[1], 10);
    }

    return data;
  }
}