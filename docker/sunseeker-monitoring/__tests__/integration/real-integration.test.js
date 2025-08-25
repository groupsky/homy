/**
 * Real integration tests with actual MQTT broker and InfluxDB
 * This test runs against real containers and validates end-to-end functionality
 */

import mqtt from 'mqtt';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import axios from 'axios';
import { TEST_MESSAGES, TEST_TOPICS } from '../../src/test-constants.js';

describe('Real Integration Tests', () => {
  let mqttClient;
  let influxClient;
  let queryApi;
  
  const config = {
    mqtt: {
      url: process.env.MQTT_URL || 'mqtt://localhost:1883',
      username: 'test-client',
      password: 'test-password-12345',
      deviceId: 'test-device-123456789',
      appId: 'test-app-987654321'
    },
    influx: {
      url: process.env.INFLUX_URL || 'http://localhost:8087',
      token: process.env.INFLUX_TOKEN || 'test-influx-token-12345',
      org: process.env.INFLUX_ORG || 'test-org',
      bucket: process.env.INFLUX_BUCKET || 'test-bucket'
    },
    service: {
      url: process.env.SERVICE_URL || 'http://localhost:8080'
    }
  };

  beforeAll(async () => {
    // Wait for services to be ready
    await waitForServices();
    
    // Connect to MQTT
    mqttClient = mqtt.connect(config.mqtt.url, {
      username: config.mqtt.username,
      password: config.mqtt.password,
      clientId: 'integration-test-client'
    });

    // Set up InfluxDB client
    influxClient = new InfluxDB({
      url: config.influx.url,
      token: config.influx.token
    });
    queryApi = influxClient.getQueryApi(config.influx.org);

    // Wait for MQTT connection
    await new Promise((resolve, reject) => {
      mqttClient.on('connect', resolve);
      mqttClient.on('error', reject);
      setTimeout(() => reject(new Error('MQTT connection timeout')), 10000);
    });
  }, 30000);

  afterAll(async () => {
    if (mqttClient) {
      await mqttClient.end();
    }
    if (influxClient) {
      await influxClient.close();
    }
  });

  describe('End-to-End Message Flow', () => {
    it('should process MQTT messages and store data in InfluxDB', async () => {
      // Send test message
      const testMessage = TEST_MESSAGES.STATUS_UPDATE;
      const topic = `/device/${config.mqtt.deviceId}/update`;
      
      mqttClient.publish(topic, JSON.stringify(testMessage));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Query InfluxDB for the data
      const query = `
        from(bucket: "${config.influx.bucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_mode")
          |> filter(fn: (r) => r["device_id"] == "${config.mqtt.deviceId}")
          |> last()
      `;
      
      const rows = [];
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next: (row, tableMeta) => {
            const rowObj = tableMeta.toObject(row);
            rows.push(rowObj);
          },
          error: reject,
          complete: resolve
        });
      });
      
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]._value).toBe(testMessage.mode);
    }, 15000);

    it('should process battery log messages and extract detailed metrics', async () => {
      const testMessage = TEST_MESSAGES.LOG_MESSAGE;
      const topic = `/device/${config.mqtt.deviceId}/update`;
      
      mqttClient.publish(topic, JSON.stringify(testMessage));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Query for battery detail data
      const query = `
        from(bucket: "${config.influx.bucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_battery_detail")
          |> filter(fn: (r) => r["device_id"] == "${config.mqtt.deviceId}")
          |> filter(fn: (r) => r["_field"] == "percentage")
          |> last()
      `;
      
      const rows = [];
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next: (row, tableMeta) => {
            const rowObj = tableMeta.toObject(row);
            rows.push(rowObj);
          },
          error: reject,
          complete: resolve
        });
      });
      
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]._value).toBe(85); // Expected battery percentage from test log
    }, 15000);

    it('should process app topic messages', async () => {
      const testMessage = TEST_MESSAGES.APP_MESSAGE;
      const topic = `/app/${config.mqtt.appId}/get`;
      
      mqttClient.publish(topic, JSON.stringify(testMessage));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Query for app message data
      const query = `
        from(bucket: "${config.influx.bucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_power")
          |> filter(fn: (r) => r["device_id"] == "${testMessage.deviceSn}")
          |> filter(fn: (r) => r["_field"] == "battery_percentage")
          |> last()
      `;
      
      const rows = [];
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next: (row, tableMeta) => {
            const rowObj = tableMeta.toObject(row);
            rows.push(rowObj);
          },
          error: reject,
          complete: resolve
        });
      });
      
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]._value).toBe(testMessage.power);
    }, 15000);
  });

  describe('Service Health and Monitoring', () => {
    it('should track connection status', async () => {
      // Send multiple messages to ensure service is active
      for (let i = 0; i < 3; i++) {
        const message = { ...TEST_MESSAGES.STATUS_UPDATE, mode: i };
        mqttClient.publish(`/device/${config.mqtt.deviceId}/update`, JSON.stringify(message));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Query connection tracking data
      const query = `
        from(bucket: "${config.influx.bucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_connection")
          |> filter(fn: (r) => r["device_id"] == "${config.mqtt.deviceId}")
          |> last()
      `;
      
      const rows = [];
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next: (row, tableMeta) => {
            const rowObj = tableMeta.toObject(row);
            rows.push(rowObj);
          },
          error: reject,
          complete: resolve
        });
      });
      
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]._value).toBe(1); // Connected
    }, 15000);
  });

  describe('Error Handling and Resilience', () => {
    it('should handle malformed messages gracefully', async () => {
      // Send invalid JSON
      mqttClient.publish(`/device/${config.mqtt.deviceId}/update`, 'invalid json');
      
      // Send valid message after invalid one
      await new Promise(resolve => setTimeout(resolve, 1000));
      const validMessage = TEST_MESSAGES.STATUS_UPDATE;
      mqttClient.publish(`/device/${config.mqtt.deviceId}/update`, JSON.stringify(validMessage));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Should still process valid messages after invalid ones
      const query = `
        from(bucket: "${config.influx.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_mode")
          |> filter(fn: (r) => r["device_id"] == "${config.mqtt.deviceId}")
          |> last()
      `;
      
      const rows = [];
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next: (row, tableMeta) => {
            const rowObj = tableMeta.toObject(row);
            rows.push(rowObj);
          },
          error: reject,
          complete: resolve
        });
      });
      
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]._value).toBe(validMessage.mode);
    }, 15000);
  });
});

/**
 * Wait for all services to be ready before running tests
 */
async function waitForServices() {
  const services = [
    { name: 'MQTT', url: config.mqtt.url.replace('mqtt://', 'http://') + ':1883' },
    { name: 'InfluxDB', url: config.influx.url + '/health' }
  ];

  for (const service of services) {
    let retries = 30;
    while (retries > 0) {
      try {
        if (service.name === 'InfluxDB') {
          await axios.get(service.url);
        } else {
          // For MQTT, just try to connect briefly
          const testClient = mqtt.connect(config.mqtt.url);
          await new Promise((resolve, reject) => {
            testClient.on('connect', () => {
              testClient.end();
              resolve();
            });
            testClient.on('error', reject);
            setTimeout(() => reject(new Error('timeout')), 2000);
          });
        }
        console.log(`✅ ${service.name} is ready`);
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          throw new Error(`❌ ${service.name} failed to start: ${error.message}`);
        }
        console.log(`⏳ Waiting for ${service.name}... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
}