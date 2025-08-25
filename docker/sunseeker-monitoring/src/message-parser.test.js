/**
 * Test cases for Sunseeker lawn mower MQTT message parser.
 * Following TDD approach - these tests define the expected behavior.
 */

import { SunseekerMessageParser } from './message-parser.js';
import { extractDeviceIdFromTopic } from './utils.js';
import { TEST_DEVICE_ID, TEST_APP_ID, TEST_TOPICS, TEST_MESSAGES } from './test-constants.js';
import {jest} from "@jest/globals";

describe('SunseekerMessageParser', () => {
  let parser;

  beforeEach(() => {
    parser = new SunseekerMessageParser();
  });

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('parseMessage', () => {
    it('should parse cmd 501 status updates with mode, power, station', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = JSON.stringify(TEST_MESSAGES.STATUS_UPDATE);

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(4); // mode, power, station, connection

      // Verify mode data point
      const modePoint = result.find(p => p.measurement === 'sunseeker_mode');
      expect(modePoint).toBeDefined();
      expect(modePoint.device_id).toBe(TEST_DEVICE_ID);
      expect(modePoint.fields.mode).toBe(3);
      expect(modePoint.fields.mode_text).toBe('Charging');

      // Verify power data point
      const powerPoint = result.find(p => p.measurement === 'sunseeker_power');
      expect(powerPoint).toBeDefined();
      expect(powerPoint.fields.battery_percentage).toBe(96);

      // Verify station data point
      const stationPoint = result.find(p => p.measurement === 'sunseeker_station');
      expect(stationPoint).toBeDefined();
      expect(stationPoint.fields.at_station).toBe(true);
    });

    it('should correctly map different operating modes', () => {
      const testCases = [
        { mode: 0, expected: 'Standby' },
        { mode: 1, expected: 'Mowing' },
        { mode: 2, expected: 'Going Home' },
        { mode: 3, expected: 'Charging' },
        { mode: 7, expected: 'Departing' }
      ];

      const topic = TEST_TOPICS.DEVICE_UPDATE;

      testCases.forEach(({ mode, expected }) => {
        const payload = JSON.stringify({ cmd: 501, mode, power: 95, station: false });
        const result = parser.parseMessage(topic, payload);

        const modePoint = result.find(p => p.measurement === 'sunseeker_mode');
        expect(modePoint.fields.mode_text).toBe(expected);
      });
    });

    it('should parse cmd 509 log messages with detailed battery information', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = JSON.stringify(TEST_MESSAGES.LOG_MESSAGE);

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint).toBeDefined();

      // Check extracted battery data
      expect(batteryPoint.fields.voltage_mv).toBe(20182);
      expect(batteryPoint.fields.min_cell_mv).toBe(3995);
      expect(batteryPoint.fields.max_cell_mv).toBe(4003);
      expect(batteryPoint.fields.temperature).toBe(24);
      expect(batteryPoint.fields.current_ma).toBe(1538);
      expect(batteryPoint.fields.percentage).toBe(94);
      expect(batteryPoint.fields.pitch).toBe(178);
      expect(batteryPoint.fields.roll).toBe(1);
      expect(batteryPoint.fields.heading).toBe(20);
    });

    it('should parse cmd 509 waiting status log messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,min=3974mV,max=3980mV,temp=32\\n"}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint).toBeDefined();

      expect(batteryPoint.fields.voltage_mv).toBe(20096);
      expect(batteryPoint.fields.percentage).toBe(97);
      expect(batteryPoint.fields.temperature).toBe(32);
      expect(batteryPoint.fields.min_cell_mv).toBe(3974);
      expect(batteryPoint.fields.max_cell_mv).toBe(3980);
    });

    it('should parse cmd 511 state change messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":511,"time":1756076015,"msg":1}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);

      const statePoint = result[0];
      expect(statePoint.measurement).toBe('sunseeker_state_change');
      expect(statePoint.fields.message_code).toBe(1);
      expect(statePoint.fields.timestamp).toBe(1756076015);
    });

    it('should parse cmd 400 command acknowledgment messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":400,"command":101,"result":true}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      const commandPoint = result[0];
      expect(commandPoint.measurement).toBe('sunseeker_commands');
      expect(commandPoint.fields.command).toBe(101);
      expect(commandPoint.fields.result).toBe(true);
    });

    it('should parse cmd 512 battery info messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = JSON.stringify(TEST_MESSAGES.BATTERY_INFO);

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);

      const batteryInfoPoint = result[0];
      expect(batteryInfoPoint.measurement).toBe('sunseeker_battery_info');
      expect(batteryInfoPoint.fields.battery_type).toBe('5S1P_TEST_BATTERY');
      expect(batteryInfoPoint.fields.battery_id).toBe(123456789);
      expect(batteryInfoPoint.fields.charge_times).toBe(93);
      expect(batteryInfoPoint.fields.discharge_times).toBe(93);
    });

    it('should handle cmd 512 messages with partial battery info', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":512,"bat_type":"5S1P_SUMSANG_25R","bat_ctimes":95}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      const batteryInfoPoint = result[0];
      expect(batteryInfoPoint.measurement).toBe('sunseeker_battery_info');
      expect(batteryInfoPoint.fields.battery_type).toBe('5S1P_SUMSANG_25R');
      expect(batteryInfoPoint.fields.charge_times).toBe(95);
      expect(batteryInfoPoint.fields.discharge_times).toBeUndefined();
      expect(batteryInfoPoint.fields.battery_id).toBeUndefined();
    });

    it('should parse app topic messages', () => {
      const topic = TEST_TOPICS.APP_GET;
      const payload = JSON.stringify(TEST_MESSAGES.APP_MESSAGE);

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();
      // Should extract device ID from payload when in app topic
      const modePoint = result.find(p => p.measurement === 'sunseeker_mode');
      expect(modePoint.device_id).toBe(TEST_DEVICE_ID);
    });

    it('should handle invalid JSON gracefully', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = 'invalid json';

      jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = parser.parseMessage(topic, payload);
      expect(result).toBeNull();
    });

    it('should handle unsupported command types', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":999,"data":"unknown"}';

      jest.spyOn(console, 'log').mockImplementation(() => {})
      const result = parser.parseMessage(topic, payload);
      expect(result).toBeNull();
    });
  });

  describe('extractDeviceIdFromTopic', () => {
    it.each([
      { topic: TEST_TOPICS.DEVICE_UPDATE, expected: TEST_DEVICE_ID },
      { topic: TEST_TOPICS.DEVICE_GET, expected: TEST_DEVICE_ID },
      { topic: TEST_TOPICS.APP_GET, expected: null } // No device ID in topic
    ])('should extract device ID from topic $topic', ({ topic, expected }) => {
        const result = extractDeviceIdFromTopic(topic);
        expect(result).toBe(expected);
    });
  });

  describe('_extractLogData', () => {
    it('should extract battery data from comprehensive log format', () => {
      const logText = 'I/charging [Sun Aug 24 22:58:16 2025] (637)bat vol=20182,min=3995mV,max=4003mV,temp=24,current=1538,percent=94,lstr=0,rstr=0,pitch=178,roll=1,heading=20';

      const result = parser._extractLogData(logText);

      const expected = {
        voltage_mv: 20182,
        min_cell_mv: 3995,
        max_cell_mv: 4003,
        temperature: 24,
        current_ma: 1538,
        percentage: 94,
        pitch: 178,
        roll: 1,
        heading: 20
      };

      expect(result).toEqual(expected);
    });

    it('should extract battery data from waiting status format', () => {
      const logText = 'I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,min=3974mV,max=3980mV,temp=32';

      const result = parser._extractLogData(logText);

      const expected = {
        voltage_mv: 20096,
        percentage: 97,
        min_cell_mv: 3974,
        max_cell_mv: 3980,
        temperature: 32
      };

      expect(result).toEqual(expected);
    });

    it('should return empty object for logs without battery data', () => {
      const logText = 'I/cutting [Sun Aug 24 22:53:35 2025] (220)start work';

      const result = parser._extractLogData(logText);

      expect(result).toEqual({});
    });
  });

  describe('battery temperature alerts', () => {
    it('should tag high temperature alerts', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,temp=45\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.tags.temp_alert).toBe('high');
    });

    it('should tag normal temperature', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,temp=25\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.tags.temp_alert).toBe('normal');
    });

    it('should tag low temperature alerts', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,temp=5\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.tags.temp_alert).toBe('low');
    });
  });

  describe('connection health tracking', () => {
    it('should create connection health data points', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":501,"mode":1,"power":85,"station":false}';

      const result = parser.parseMessage(topic, payload);

      const healthPoint = result.find(p => p.measurement === 'sunseeker_connection');
      expect(healthPoint).toBeDefined();
      expect(healthPoint.fields.connected).toBe(true);
    });
  });
});

describe('InfluxDataPoint', () => {
  it('should create data points with correct structure', () => {
    // This will be tested when we implement the InfluxDataPoint class
    // For now, we define the expected interface
    const point = {
      measurement: 'test_measurement',
      device_id: 'test_device',
      fields: { value: 42, text: 'test' },
      tags: { location: 'garden' },
      timestamp: expect.any(Date)
    };

    expect(point.measurement).toBe('test_measurement');
    expect(point.device_id).toBe('test_device');
    expect(point.fields.value).toBe(42);
    expect(point.tags.location).toBe('garden');
  });
});
