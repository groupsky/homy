/**
 * Tests for the optional local broker setting (BROKER).
 */

import { jest } from '@jest/globals';
import { loadConfig } from './config.js';

const VENDOR_ENV = {
  MQTT_PASSWORD: 'test-password',
  MQTT_DEVICE_ID: 'TEST_DEVICE',
  MQTT_APP_ID: 'test-app',
  INFLUXDB_TOKEN: 'test-token'
};

describe('loadConfig local broker', () => {
  const saved = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = saved;
    jest.restoreAllMocks();
  });

  it('has no local broker without BROKER', () => {
    process.env = { ...VENDOR_ENV };
    expect(loadConfig().localMqtt).toBeNull();
  });

  it('takes the local broker from BROKER', () => {
    process.env = { ...VENDOR_ENV, BROKER: 'mqtt://broker' };
    const config = loadConfig();
    expect(config.localMqtt).toEqual({ url: 'mqtt://broker' });
    // The vendor broker settings stay as they are
    expect(config.mqtt.url).not.toBe('mqtt://broker');
  });
});
