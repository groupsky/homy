/**
 * Tests for InfluxDB point construction, in particular field typing.
 *
 * InfluxDB 1.x fixes a field's type per shard group from the first write of
 * that field. Typing a float field as an integer because its runtime value
 * happened to be round poisons the whole shard: every later float write is
 * rejected with a 400 field type conflict and InfluxDB drops the entire point.
 */

import { SunseekerMqttInfluxService } from './mqtt-influx-service.js';
import { MEASUREMENTS } from './constants.js';

const TEST_DEVICE_ID = 'TEST_DEVICE_0000000000000';

const TEST_CONFIG = {
  mqtt: {
    url: 'mqtt://mqtt-broker.test:1883',
    username: 'test-user',
    password: 'test-password',
    deviceId: TEST_DEVICE_ID,
    appId: 'test-app-id'
  },
  influx: {
    url: 'http://influxdb.test:8086',
    token: 'test-token',
    bucket: 'test-bucket',
    org: 'test-org'
  }
};

/** Parse `key=value` pairs out of the field section of a line protocol string. */
function fieldsOf(point) {
  const line = point.toLineProtocol();
  const fieldSection = line.slice(line.indexOf(' ') + 1, line.lastIndexOf(' '));

  return Object.fromEntries(
    fieldSection.split(',').map((pair) => {
      const separator = pair.indexOf('=');
      return [pair.slice(0, separator), pair.slice(separator + 1)];
    })
  );
}

describe('SunseekerMqttInfluxService._createInfluxPoint', () => {
  let service;

  beforeEach(() => {
    service = new SunseekerMqttInfluxService(TEST_CONFIG);
  });

  const batteryDetailPoint = (fields) =>
    service._createInfluxPoint({
      measurement: MEASUREMENTS.BATTERY_DETAIL,
      device_id: TEST_DEVICE_ID,
      fields,
      tags: {},
      timestamp: new Date('2026-07-29T12:00:00Z')
    });

  describe('float fields with round values', () => {
    // 4000mV / 1000 === 4 in JavaScript - indistinguishable from an integer at
    // runtime, but semantically still a float field.
    it.each([
      ['max_cell_voltage', 4],
      ['min_cell_voltage', 4],
      ['voltage', 20],
      ['current', 1]
    ])('writes %s=%d as a float', (field, value) => {
      const fields = fieldsOf(batteryDetailPoint({ [field]: value }));

      expect(fields[field]).toBe(String(value));
      expect(fields[field]).not.toMatch(/i$/);
    });

    it('keeps float typing consistent across round and fractional values', () => {
      const round = fieldsOf(batteryDetailPoint({ max_cell_voltage: 4 }));
      const fractional = fieldsOf(batteryDetailPoint({ max_cell_voltage: 4.041 }));

      expect(round.max_cell_voltage).not.toMatch(/i$/);
      expect(fractional.max_cell_voltage).not.toMatch(/i$/);
    });

    it('writes every float field of a full battery detail point as a float', () => {
      const fields = fieldsOf(
        batteryDetailPoint({
          voltage: 20,
          voltage_mv: 20000,
          max_cell_voltage: 4,
          max_cell_mv: 4000,
          min_cell_voltage: 4,
          min_cell_mv: 4000,
          current: 2,
          current_ma: 2000,
          temperature: 30,
          percentage: 98
        })
      );

      for (const field of ['voltage', 'max_cell_voltage', 'min_cell_voltage', 'current']) {
        expect(fields[field]).not.toMatch(/i$/);
      }
    });
  });

  describe('integer fields', () => {
    it.each([
      ['voltage_mv', 20151],
      ['max_cell_mv', 4000],
      ['min_cell_mv', 3989],
      ['current_ma', 2000],
      ['temperature', 30],
      ['percentage', 98],
      ['pitch', 1],
      ['roll', 2],
      ['heading', 180]
    ])('writes %s=%d as an integer', (field, value) => {
      const fields = fieldsOf(batteryDetailPoint({ [field]: value }));

      expect(fields[field]).toBe(`${value}i`);
    });
  });

  describe('non-numeric fields', () => {
    it('writes booleans as booleans', () => {
      const point = service._createInfluxPoint({
        measurement: MEASUREMENTS.STATION,
        device_id: TEST_DEVICE_ID,
        fields: { at_station: true },
        tags: {},
        timestamp: new Date('2026-07-29T12:00:00Z')
      });

      expect(fieldsOf(point).at_station).toBe('T');
    });

    it('writes strings as quoted strings', () => {
      const point = service._createInfluxPoint({
        measurement: MEASUREMENTS.MODE,
        device_id: TEST_DEVICE_ID,
        fields: { mode: 1, mode_text: 'mowing' },
        tags: {},
        timestamp: new Date('2026-07-29T12:00:00Z')
      });

      const fields = fieldsOf(point);
      expect(fields.mode).toBe('1i');
      expect(fields.mode_text).toBe('"mowing"');
    });
  });

  describe('tags', () => {
    it('applies device_id and extra tags', () => {
      const point = batteryDetailPoint({ temperature: 30 });
      expect(point.toLineProtocol()).toContain(`device_id=${TEST_DEVICE_ID}`);
    });
  });
});
