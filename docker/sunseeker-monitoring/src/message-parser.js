/**
 * Sunseeker lawn mower MQTT message parser
 * Converts MQTT messages to InfluxDB data points
 */

import { SUNSEEKER_MODES, TEMPERATURE, MEASUREMENTS, COMMAND_TYPES, RAIN_KEY_PATTERN, RAIN_MAX_DEPTH } from './constants.js';
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

    // The rain sensor's field name is not known yet (#1841), so every field
    // with a rain name is logged, before the device id check and for any cmd.
    const rainFields = this._findRainFields(data);
    rainFields.forEach(({ path, value }) => {
      // Strings are quoted so a newline in a value cannot fake another log line
      const shown = typeof value === 'string' ? JSON.stringify(value) : value;
      logger.info(`Rain field seen: cmd=${data.cmd} ${path}=${shown}`);
    });

    if (!deviceId) {
      logger.warn('No device ID found in topic or payload');
      return null;
    }

    const points = this._parseByCommand(data, deviceId);
    if (rainFields.length === 0) return points;

    return [...(points || []), ...this._createRainPoints(rainFields, data.cmd, deviceId)];
  }

  /**
   * Find scalar fields whose path has a rain name (see RAIN_KEY_PATTERN).
   * Looks into nested objects and into string values that hold a JSON object
   * (the mower may send `data` that way).
   * @private
   */
  _findRainFields(node, prefix = '', depth = 1, underRain = false) {
    const found = [];
    if (depth > RAIN_MAX_DEPTH) return found;

    for (const [key, raw] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const isRain = underRain || RAIN_KEY_PATTERN.test(key);
      const value = this._parseJsonObjectString(raw);

      if (value !== null && typeof value === 'object') {
        found.push(...this._findRainFields(value, path, depth + 1, isRain));
      } else if (isRain) {
        found.push({ path, value });
      }
    }

    return found;
  }

  /**
   * Return the parsed object if the value is a JSON object string, else the value
   * @private
   */
  _parseJsonObjectString(value) {
    if (typeof value !== 'string' || !value.trim().startsWith('{')) return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Create one sunseeker_rain point per rain field
   * @private
   */
  _createRainPoints(rainFields, cmd, deviceId) {
    const timestamp = new Date();

    // A null has no value to store; it is only logged
    return rainFields.filter(({ value }) => value !== null).map(({ path, value }) => {
      let fields;
      if (Number.isFinite(value)) {
        fields = { value };
      } else if (typeof value === 'boolean') {
        fields = { value: value ? 1 : 0 };
      } else {
        fields = { value_text: String(value) };
      }

      const tags = { field: path };
      if (cmd !== undefined && cmd !== null) tags.cmd = String(cmd);

      return {
        measurement: MEASUREMENTS.RAIN,
        device_id: deviceId,
        fields,
        tags,
        timestamp
      };
    });
  }

  /**
   * Parse message based on command type
   * @private
   */
  _parseByCommand(data, deviceId) {
    const cmd = data.cmd;
    let points = [];
    
    switch (cmd) {
      case COMMAND_TYPES.STATUS_UPDATE:
        points = this._parseStatusMessage(data, deviceId);
        break;
      case COMMAND_TYPES.LOG_MESSAGE:
        points = this._parseLogMessage(data, deviceId);
        break;
      case COMMAND_TYPES.STATE_CHANGE:
        points = this._parseStateChangeMessage(data, deviceId);
        break;
      case COMMAND_TYPES.BATTERY_INFO:
        points = this._parseBatteryInfoMessage(data, deviceId);
        break;
      case COMMAND_TYPES.COMMAND_ACK:
        points = this._parseCommandAckMessage(data, deviceId);
        break;
      default:
        logger.warn(`Unsupported command type: ${cmd}`);
        return null;
    }

    // Add connection health point for all successfully parsed messages
    if (points && points.length > 0) {
      const connectionPoint = this._createConnectionHealthPoint(deviceId);
      points.push(connectionPoint);
    }

    return points;
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

    // Extract battery voltage (convert mV to V)
    const volMatch = logText.match(/bat vol=(\d+)(?:mV)?/);
    if (volMatch) {
      const millivolts = parseInt(volMatch[1], 10);
      data.voltage_mv = millivolts; // Keep original for compatibility
      data.voltage = millivolts / 1000; // Convert to volts
    }

    // Extract percentage
    const percentMatch = logText.match(/percent=(\d+)/);
    if (percentMatch) {
      data.percentage = parseInt(percentMatch[1], 10);
    }

    // Extract min cell voltage (convert mV to V)
    const minMatch = logText.match(/min=(\d+)mV/);
    if (minMatch) {
      const millivolts = parseInt(minMatch[1], 10);
      data.min_cell_mv = millivolts; // Keep original for compatibility
      data.min_cell_voltage = millivolts / 1000; // Convert to volts
    }

    // Extract max cell voltage (convert mV to V)
    const maxMatch = logText.match(/max=(\d+)mV/);
    if (maxMatch) {
      const millivolts = parseInt(maxMatch[1], 10);
      data.max_cell_mv = millivolts; // Keep original for compatibility
      data.max_cell_voltage = millivolts / 1000; // Convert to volts
    }

    // Extract temperature. Below 0 °C the firmware prints a minus sign (temp=-3).
    const tempMatch = logText.match(/temp=(-?\d+)/);
    if (tempMatch) {
      data.temperature = parseInt(tempMatch[1], 10);
    }

    // Extract current (convert mA to A)
    const currentMatch = logText.match(/current=(\d+)/);
    if (currentMatch) {
      const milliamperes = parseInt(currentMatch[1], 10);
      data.current_ma = milliamperes; // Keep original for compatibility
      data.current = milliamperes / 1000; // Convert to amperes
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

  /**
   * Create connection health point for all message types
   * @private
   */
  _createConnectionHealthPoint(deviceId) {
    return {
      measurement: MEASUREMENTS.CONNECTION,
      device_id: deviceId,
      fields: {
        connected: true
      },
      tags: {},
      timestamp: new Date()
    };
  }
}