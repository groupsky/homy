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
      expect(modePoint.fields.mode_text).toBe('charging');

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
        { mode: 0, expected: 'standby' },
        { mode: 1, expected: 'mowing' },
        { mode: 2, expected: 'on_the_way_home' },
        { mode: 3, expected: 'charging' },
        { mode: 7, expected: 'mowing_border' }
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
      
      // Verify battery detail point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_battery_detail',
        device_id: TEST_DEVICE_ID,
        fields: expect.objectContaining({
          voltage_mv: 20182,
          voltage: 20.182,
          min_cell_mv: 3995,
          min_cell_voltage: 3.995,
          max_cell_mv: 4003,
          max_cell_voltage: 4.003,
          temperature: 24,
          current_ma: 1538,
          current: 1.538,
          percentage: 94,
          pitch: 178,
          roll: 1,
          heading: 20
        }),
        tags: expect.objectContaining({
          temp_alert: 'normal'
        }),
        timestamp: expect.any(Date)
      }));

      // Verify connection health point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_connection',
        device_id: TEST_DEVICE_ID,
        fields: {
          connected: true
        },
        tags: {},
        timestamp: expect.any(Date)
      }));
    });

    it('should parse cmd 509 waiting status log messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,min=3974mV,max=3980mV,temp=32\\n"}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();

      // Verify battery detail point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_battery_detail',
        device_id: TEST_DEVICE_ID,
        fields: expect.objectContaining({
          voltage_mv: 20096,
          voltage: 20.096,
          percentage: 97,
          min_cell_mv: 3974,
          min_cell_voltage: 3.974,
          max_cell_mv: 3980,
          max_cell_voltage: 3.980,
          temperature: 32
        }),
        tags: expect.objectContaining({
          temp_alert: 'normal'
        }),
        timestamp: expect.any(Date)
      }));

      // Verify connection health point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_connection',
        device_id: TEST_DEVICE_ID,
        fields: {
          connected: true
        },
        tags: {},
        timestamp: expect.any(Date)
      }));
    });

    it('should parse cmd 511 state change messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":511,"time":1756076015,"msg":1}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();

      // Verify state change point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_state_change',
        device_id: TEST_DEVICE_ID,
        fields: {
          message_code: 1,
          timestamp: 1756076015
        },
        tags: {},
        timestamp: expect.any(Date)
      }));

      // Verify connection health point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_connection',
        device_id: TEST_DEVICE_ID,
        fields: {
          connected: true
        },
        tags: {},
        timestamp: expect.any(Date)
      }));
    });

    it('should parse cmd 400 command acknowledgment messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":400,"command":101,"result":true}';

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();

      // Verify command point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_commands',
        device_id: TEST_DEVICE_ID,
        fields: {
          command: 101,
          result: true
        },
        tags: {},
        timestamp: expect.any(Date)
      }));

      // Verify connection health point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_connection',
        device_id: TEST_DEVICE_ID,
        fields: {
          connected: true
        },
        tags: {},
        timestamp: expect.any(Date)
      }));
    });

    it('should parse cmd 512 battery info messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = JSON.stringify(TEST_MESSAGES.BATTERY_INFO);

      const result = parser.parseMessage(topic, payload);

      expect(result).not.toBeNull();

      // Verify battery info point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_battery_info',
        device_id: TEST_DEVICE_ID,
        fields: {
          battery_type: '5S1P_TEST_BATTERY',
          battery_id: 123456789,
          charge_times: 93,
          discharge_times: 93
        },
        tags: {},
        timestamp: expect.any(Date)
      }));

      // Verify connection health point
      expect(result).toContainEqual(expect.objectContaining({
        measurement: 'sunseeker_connection',
        device_id: TEST_DEVICE_ID,
        fields: {
          connected: true
        },
        tags: {},
        timestamp: expect.any(Date)
      }));
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
        voltage: 20.182,
        min_cell_mv: 3995,
        min_cell_voltage: 3.995,
        max_cell_mv: 4003,
        max_cell_voltage: 4.003,
        temperature: 24,
        current_ma: 1538,
        current: 1.538,
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
        voltage: 20.096,
        percentage: 97,
        min_cell_mv: 3974,
        min_cell_voltage: 3.974,
        max_cell_mv: 3980,
        max_cell_voltage: 3.980,
        temperature: 32
      };

      expect(result).toEqual(expected);
    });

    it('should return empty object for logs without battery data', () => {
      const logText = 'I/cutting [Sun Aug 24 22:53:35 2025] (220)start work';

      const result = parser._extractLogData(logText);

      expect(result).toEqual({});
    });

    it('should convert voltage from millivolts to volts with proper precision', () => {
      const testCases = [
        { input: 'bat vol=20000', expectedMv: 20000, expectedV: 20.0 },
        { input: 'bat vol=20182mV', expectedMv: 20182, expectedV: 20.182 },
        { input: 'bat vol=19500', expectedMv: 19500, expectedV: 19.5 },
        { input: 'bat vol=21250mV', expectedMv: 21250, expectedV: 21.25 }
      ];

      testCases.forEach(({ input, expectedMv, expectedV }) => {
        const result = parser._extractLogData(input);
        
        expect(result.voltage_mv).toBe(expectedMv);
        expect(result.voltage).toBe(expectedV);
      });
    });

    it('should convert current from milliamperes to amperes with proper precision', () => {
      const testCases = [
        { input: 'current=1000', expectedMa: 1000, expectedA: 1.0 },
        { input: 'current=1538', expectedMa: 1538, expectedA: 1.538 },
        { input: 'current=500', expectedMa: 500, expectedA: 0.5 },
        { input: 'current=2750', expectedMa: 2750, expectedA: 2.75 }
      ];

      testCases.forEach(({ input, expectedMa, expectedA }) => {
        const result = parser._extractLogData(input);
        
        expect(result.current_ma).toBe(expectedMa);
        expect(result.current).toBe(expectedA);
      });
    });

    it('should handle logs with only voltage data', () => {
      const logText = 'I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97';

      const result = parser._extractLogData(logText);

      expect(result.voltage_mv).toBe(20096);
      expect(result.voltage).toBe(20.096);
      expect(result.current_ma).toBeUndefined();
      expect(result.current).toBeUndefined();
      expect(result.percentage).toBe(97);
    });

    it('should handle logs with only current data', () => {
      const logText = 'I/mowing [Sun Aug 24 22:58:16 2025] (637)current=2100,percent=85';

      const result = parser._extractLogData(logText);

      expect(result.current_ma).toBe(2100);
      expect(result.current).toBe(2.1);
      expect(result.voltage_mv).toBeUndefined();
      expect(result.voltage).toBeUndefined();
      expect(result.percentage).toBe(85);
    });

    it('should convert cell voltages from millivolts to volts with proper precision', () => {
      const testCases = [
        { input: 'min=3995mV,max=4003mV', expectedMinMv: 3995, expectedMinV: 3.995, expectedMaxMv: 4003, expectedMaxV: 4.003 },
        { input: 'min=4000mV,max=4050mV', expectedMinMv: 4000, expectedMinV: 4.0, expectedMaxMv: 4050, expectedMaxV: 4.05 },
        { input: 'min=3750mV,max=3825mV', expectedMinMv: 3750, expectedMinV: 3.75, expectedMaxMv: 3825, expectedMaxV: 3.825 }
      ];

      testCases.forEach(({ input, expectedMinMv, expectedMinV, expectedMaxMv, expectedMaxV }) => {
        const result = parser._extractLogData(input);
        
        expect(result.min_cell_mv).toBe(expectedMinMv);
        expect(result.min_cell_voltage).toBe(expectedMinV);
        expect(result.max_cell_mv).toBe(expectedMaxMv);
        expect(result.max_cell_voltage).toBe(expectedMaxV);
      });
    });

    it('should handle logs with only min cell voltage', () => {
      const logText = 'I/charging [Sun Aug 24 22:58:16 2025] (637)min=3995mV,percent=94';

      const result = parser._extractLogData(logText);

      expect(result.min_cell_mv).toBe(3995);
      expect(result.min_cell_voltage).toBe(3.995);
      expect(result.max_cell_mv).toBeUndefined();
      expect(result.max_cell_voltage).toBeUndefined();
      expect(result.percentage).toBe(94);
    });
  });

  describe('battery temperature alerts', () => {
    it('should tag high temperature alerts and include volt conversion', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,temp=45\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.tags.temp_alert).toBe('high');
      expect(batteryPoint.fields.voltage_mv).toBe(20096);
      expect(batteryPoint.fields.voltage).toBe(20.096);
    });

    it('should tag normal temperature and include volt conversion', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,temp=25\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.tags.temp_alert).toBe('normal');
      expect(batteryPoint.fields.voltage_mv).toBe(20096);
      expect(batteryPoint.fields.voltage).toBe(20.096);
    });

    it('should keep a temperature below zero as a negative number (#1736)', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Jan 11 04:12:43 2026] (856)bat vol=20096mV, percent=97,min=3974mV,max=3980mV,temp=-3\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.fields.temperature).toBe(-3);
      expect(batteryPoint.tags.temp_alert).toBe('low');
    });

    it('should not read a dash after temp= without digits as a temperature', () => {
      expect(parser._extractLogData('I/waiting bat vol=20096mV, temp=-').temperature).toBeUndefined();
    });

    it('should tag low temperature alerts and include volt conversion', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":509,"lv":3,"log":"I/waiting [Sun Aug 24 19:12:43 2025] (856)bat vol=20096mV, percent=97,temp=5\\n"}';

      const result = parser.parseMessage(topic, payload);

      const batteryPoint = result.find(p => p.measurement === 'sunseeker_battery_detail');
      expect(batteryPoint.tags.temp_alert).toBe('low');
      expect(batteryPoint.fields.voltage_mv).toBe(20096);
      expect(batteryPoint.fields.voltage).toBe(20.096);
    });
  });

  describe('connection health tracking', () => {
    it('should create connection health data points for cmd 501 status updates', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":501,"mode":1,"power":85,"station":false}';

      const result = parser.parseMessage(topic, payload);

      const healthPoint = result.find(p => p.measurement === 'sunseeker_connection');
      expect(healthPoint).toBeDefined();
      expect(healthPoint.fields.connected).toBe(true);
      expect(healthPoint.device_id).toBe(TEST_DEVICE_ID);
      expect(healthPoint.timestamp).toBeInstanceOf(Date);
    });

    it('should create connection health data points for cmd 509 log messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = JSON.stringify(TEST_MESSAGES.LOG_MESSAGE);

      const result = parser.parseMessage(topic, payload);

      const healthPoint = result.find(p => p.measurement === 'sunseeker_connection');
      expect(healthPoint).toBeDefined();
      expect(healthPoint.fields.connected).toBe(true);
      expect(healthPoint.device_id).toBe(TEST_DEVICE_ID);
    });

    it('should create connection health data points for cmd 511 state change messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":511,"time":1756076015,"msg":1}';

      const result = parser.parseMessage(topic, payload);

      const healthPoint = result.find(p => p.measurement === 'sunseeker_connection');
      expect(healthPoint).toBeDefined();
      expect(healthPoint.fields.connected).toBe(true);
      expect(healthPoint.device_id).toBe(TEST_DEVICE_ID);
    });

    it('should create connection health data points for cmd 512 battery info messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = JSON.stringify(TEST_MESSAGES.BATTERY_INFO);

      const result = parser.parseMessage(topic, payload);

      const healthPoint = result.find(p => p.measurement === 'sunseeker_connection');
      expect(healthPoint).toBeDefined();
      expect(healthPoint.fields.connected).toBe(true);
      expect(healthPoint.device_id).toBe(TEST_DEVICE_ID);
    });

    it('should create connection health data points for cmd 400 command acknowledgments', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":400,"command":101,"result":true}';

      const result = parser.parseMessage(topic, payload);

      const healthPoint = result.find(p => p.measurement === 'sunseeker_connection');
      expect(healthPoint).toBeDefined();
      expect(healthPoint.fields.connected).toBe(true);
      expect(healthPoint.device_id).toBe(TEST_DEVICE_ID);
    });

    it('should not create connection health data points for invalid messages', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = '{"cmd":999,"data":"unknown"}';

      jest.spyOn(console, 'log').mockImplementation(() => {});
      const result = parser.parseMessage(topic, payload);

      expect(result).toBeNull();
    });

    it('should not create connection health data points for invalid JSON', () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const payload = 'invalid json';

      jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = parser.parseMessage(topic, payload);

      expect(result).toBeNull();
    });
  });
});

describe('rain fields', () => {
  let parser;
  let logSpy;

  beforeEach(() => {
    parser = new SunseekerMessageParser();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const rainPoints = (result) => (result || []).filter(p => p.measurement === 'sunseeker_rain');
  const rainLogLines = () => logSpy.mock.calls
    .map(args => args.join(' '))
    .filter(line => line.includes('Rain field seen'));

  it('stores and logs a top-level rain_status', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"mode":0,"rain_status":2}');

    const points = rainPoints(result);
    expect(points).toHaveLength(1);
    expect(points[0].device_id).toBe(TEST_DEVICE_ID);
    expect(points[0].tags).toEqual({ field: 'rain_status', cmd: '501' });
    expect(points[0].fields).toEqual({ value: 2 });
    expect(points[0].timestamp).toBeInstanceOf(Date);
    expect(rainLogLines()).toEqual([expect.stringContaining('Rain field seen: cmd=501 rain_status=2')]);
  });

  it('keeps the existing points of a supported cmd', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"mode":0,"power":90,"station":true,"rain_en":1}');

    expect(result.map(p => p.measurement)).toEqual([
      'sunseeker_mode', 'sunseeker_power', 'sunseeker_station', 'sunseeker_connection', 'sunseeker_rain'
    ]);
  });

  it('finds every field of a nested rain object', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain":{"rain_flag":true,"delay":25}}');

    const points = rainPoints(result);
    expect(points.map(p => [p.tags.field, p.fields])).toEqual([
      ['rain.rain_flag', { value: 1 }],
      ['rain.delay', { value: 25 }]
    ]);
    expect(rainLogLines()).toEqual([
      expect.stringContaining('Rain field seen: cmd=501 rain.rain_flag=true'),
      expect.stringContaining('Rain field seen: cmd=501 rain.delay=25')
    ]);
  });

  it('finds rain_status inside a data object', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"data":{"rain_status":1,"other":5}}');

    const points = rainPoints(result);
    expect(points).toHaveLength(1);
    expect(points[0].tags.field).toBe('data.rain_status');
    expect(points[0].fields).toEqual({ value: 1 });
  });

  it('finds rain_status inside data sent as a JSON string', () => {
    const payload = JSON.stringify({ cmd: 501, data: JSON.stringify({ rain_status: 1, rain_countdown: 30 }) });
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, payload);

    expect(rainPoints(result).map(p => [p.tags.field, p.fields.value])).toEqual([
      ['data.rain_status', 1],
      ['data.rain_countdown', 30]
    ]);
  });

  it('stores booleans as 1 and 0', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain_en":false,"rain_flag":true}');

    expect(rainPoints(result).map(p => [p.tags.field, p.fields])).toEqual([
      ['rain_en', { value: 0 }],
      ['rain_flag', { value: 1 }]
    ]);
  });

  it('stores strings as value_text', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rainState":"wet"}');

    expect(rainPoints(result).map(p => p.fields)).toEqual([{ value_text: 'wet' }]);
  });

  it('quotes string values in the log line', () => {
    parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain_text":"a\\nb"}');

    expect(rainLogLines()).toEqual([expect.stringContaining('Rain field seen: cmd=501 rain_text="a\\nb"')]);
  });

  it('logs a null rain field but stores no point for it', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain_status":null}');

    expect(rainPoints(result)).toHaveLength(0);
    expect(rainLogLines()).toEqual([expect.stringContaining('Rain field seen: cmd=501 rain_status=null')]);
  });

  it('stores a number too big for a float as value_text', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain_x":1e400}');

    expect(rainPoints(result).map(p => p.fields)).toEqual([{ value_text: 'Infinity' }]);
  });

  it('finds rain fields in an array under a rain key', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain":[1,0]}');

    expect(rainPoints(result).map(p => [p.tags.field, p.fields.value])).toEqual([['rain.0', 1], ['rain.1', 0]]);
  });

  it('leaves out the cmd tag when the message has no cmd', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"rain_status":1}');

    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual({ field: 'rain_status' });
  });

  it('finds a rain field in a message of an unsupported cmd', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":999,"rain_delay_left":40}');

    expect(result).toHaveLength(1);
    expect(result[0].measurement).toBe('sunseeker_rain');
    expect(result[0].tags).toEqual({ field: 'rain_delay_left', cmd: '999' });
    expect(result[0].fields).toEqual({ value: 40 });
    expect(rainLogLines()).toEqual([expect.stringContaining('Rain field seen: cmd=999 rain_delay_left=40')]);
  });

  it('uses deviceSn from an app topic', () => {
    const result = parser.parseMessage(TEST_TOPICS.APP_GET, `{"cmd":501,"deviceSn":"${TEST_DEVICE_ID}","rain_status":0}`);

    expect(rainPoints(result)[0].device_id).toBe(TEST_DEVICE_ID);
  });

  it('adds no point and no log line when there is no rain field', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, JSON.stringify(TEST_MESSAGES.STATUS_UPDATE));

    expect(rainPoints(result)).toHaveLength(0);
    expect(rainLogLines()).toHaveLength(0);
  });

  it('does not match words that only contain "rain" inside', () => {
    const payload = '{"cmd":501,"train":1,"drain":2,"strain_level":3,"brain":{"x":4}}';
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, payload);

    expect(rainPoints(result)).toHaveLength(0);
    expect(rainLogLines()).toHaveLength(0);
  });

  it('matches case-insensitively and after an underscore', () => {
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"RAIN":1,"is_rain":2,"rainFlag":3}');

    expect(rainPoints(result).map(p => p.tags.field)).toEqual(['RAIN', 'is_rain', 'rainFlag']);
  });

  it('does not look deeper than 4 levels', () => {
    const payload = '{"cmd":501,"a":{"b":{"c":{"rain":1,"d":{"rain":2}}}}}';
    const result = parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, payload);

    expect(rainPoints(result).map(p => p.tags.field)).toEqual(['a.b.c.rain']);
  });

  it('logs no device id and no topic', () => {
    parser.parseMessage(TEST_TOPICS.DEVICE_UPDATE, '{"cmd":501,"rain_status":1}');

    for (const line of rainLogLines()) {
      expect(line).not.toContain(TEST_DEVICE_ID);
      expect(line).not.toContain('/device/');
    }
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
