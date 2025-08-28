/**
 * Testcontainers integration tests for Sunseeker monitoring service
 * Tests the real service container against real MQTT broker and InfluxDB containers
 */

import { GenericContainer, Network, Wait } from 'testcontainers';
import mqtt from 'mqtt';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { TEST_MESSAGES, TEST_DEVICE_ID, TEST_APP_ID } from '../../src/test-constants.js';

describe('Sunseeker Service Integration Tests', () => {
  let network;
  let mosquittoContainer;
  let influxContainer;
  let serviceContainer;
  let mqttClient;
  let influxClient;
  let queryApi;
  let serviceLogStream;

  const TEST_CONFIG = {
    influx: {
      username: 'admin',
      password: 'test-password-123',
      org: 'test-org',
      bucket: 'test-bucket',
      token: 'test-token-12345'
    }
  };

  beforeAll(async () => {
    // Create dedicated network for container communication
    network = await new Network().start();

    // Start Eclipse Mosquitto MQTT broker
    mosquittoContainer = await new GenericContainer('eclipse-mosquitto:2.0')
      .withNetwork(network)
      .withNetworkAliases('mqtt-broker')
      .withExposedPorts(1883)
      .withCopyFilesToContainer([
        {
          source: import.meta.dirname + '/../../test-config/mosquitto.conf',
          target: '/mosquitto/config/mosquitto.conf',
          mode: 'ro'
        }
      ])
      .withWaitStrategy(Wait.forLogMessage('mosquitto version'))
      .start();

    // Start InfluxDB
    influxContainer = await new GenericContainer('influxdb:2.7')
      .withNetwork(network)
      .withNetworkAliases('influxdb')
      .withExposedPorts(8086)
      .withEnvironment({
        DOCKER_INFLUXDB_INIT_MODE: 'setup',
        DOCKER_INFLUXDB_INIT_USERNAME: TEST_CONFIG.influx.username,
        DOCKER_INFLUXDB_INIT_PASSWORD: TEST_CONFIG.influx.password,
        DOCKER_INFLUXDB_INIT_ORG: TEST_CONFIG.influx.org,
        DOCKER_INFLUXDB_INIT_BUCKET: TEST_CONFIG.influx.bucket,
        DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: TEST_CONFIG.influx.token
      })
      .withWaitStrategy(Wait.forHttp('/health', 8086))
      .start();

    // Build and start the Sunseeker monitoring service

    // First build the container from Dockerfile
    const builtContainer = await GenericContainer
      .fromDockerfile('.', 'Dockerfile')
      .build();

    // Then configure and start the container
    serviceContainer = await builtContainer
      .withNetwork(network)
      .withNetworkAliases('sunseeker-service')
      .withEnvironment({
        // MQTT configuration pointing to test broker
        MQTT_URL: 'mqtt://mqtt-broker:1883',
        MQTT_USERNAME: 'test-client',
        MQTT_PASSWORD: 'test-password',
        MQTT_DEVICE_ID: TEST_DEVICE_ID,
        MQTT_APP_ID: TEST_APP_ID,
        // InfluxDB configuration pointing to test database
        INFLUXDB_URL: 'http://influxdb:8086',
        INFLUXDB_TOKEN: TEST_CONFIG.influx.token,
        INFLUXDB_ORG: TEST_CONFIG.influx.org,
        INFLUXDB_BUCKET: TEST_CONFIG.influx.bucket,
        // Service configuration
        NODE_ENV: 'test',
        LOG_LEVEL: 'debug'
      })
      .withWaitStrategy(Wait.forLogMessage('✅ Service started successfully'))
      .start();

    // Connect test MQTT client for message injection
    const mqttUrl = `mqtt://${mosquittoContainer.getHost()}:${mosquittoContainer.getMappedPort(1883)}`;
    mqttClient = mqtt.connect(mqttUrl, {
      clientId: 'testcontainers-test-client'
    });

    await new Promise((resolve, reject) => {
      mqttClient.on('connect', () => {
        resolve();
      });
      mqttClient.on('error', (reason) => {
        reject(reason)
      });
      setTimeout(() => reject(new Error('Test MQTT connection timeout')), 10000);
    });

    // Set up InfluxDB client for verification
    const influxUrl = `http://${influxContainer.getHost()}:${influxContainer.getMappedPort(8086)}`;
    influxClient = new InfluxDB({
      url: influxUrl,
      token: TEST_CONFIG.influx.token
    });
    queryApi = influxClient.getQueryApi(TEST_CONFIG.influx.org);

    serviceLogStream = await serviceContainer.logs()

    await waitForLog('Service started successfully', 10000)
  }, 120000); // Extended timeout for container startup

  beforeEach(async () => {
    // clear influxdb data
    await influxContainer.exec(['influx', 'delete', '--bucket', TEST_CONFIG.influx.bucket, '--org', TEST_CONFIG.influx.org, '--start', '1970-01-01T00:00:00Z', '--stop', '2100-01-01T00:00:00Z' ]);
  })

  afterAll(async () => {
    if (mqttClient) {
      await mqttClient.endAsync();
    }

    if (influxClient) {
      // InfluxDB client doesn't have a close method - just set to null
      influxClient = null;
    }

    // Stop containers in reverse order
    await Promise.all([
      serviceContainer?.stop({remove: true, removeVolumes: true}),
      influxContainer?.stop({remove: true, removeVolumes: true}),
      mosquittoContainer?.stop({remove: true, removeVolumes: true}),
    ]);
    await network?.stop();
  }, 30000);

  describe('Real Service Integration Tests', () => {
    it('should process device status update messages and write to InfluxDB', async () => {
      const deviceTopic = `/device/${TEST_DEVICE_ID}/update`;
      const testMessage = TEST_MESSAGES.STATUS_UPDATE;

      const waitForLogPromise = waitForLog( /Wrote 4 points to InfluxDB/i)

      mqttClient.publish(deviceTopic, JSON.stringify(testMessage));

      await waitForLogPromise

      // Query InfluxDB for the processed data
      const query = `
        from(bucket: "${TEST_CONFIG.influx.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_mode" or r["_measurement"] == "sunseeker_power")
          |> filter(fn: (r) => r["device_id"] == "${TEST_DEVICE_ID}")
          |> sort(columns: ["_time"], desc: true)
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

      expect(rows).toHaveLength(3)

      const modeRow = rows.find(r => r._measurement === 'sunseeker_mode');
      const powerRow = rows.find(r => r._measurement === 'sunseeker_power');

      expect(modeRow).toBeDefined();
      expect(modeRow._value).toBe(testMessage.mode);

      expect(powerRow).toBeDefined();
      expect(powerRow._value).toBe(testMessage.power);
    }, 30000);

    it('should process battery log messages and extract detailed metrics', async () => {
      const deviceTopic = `/device/${TEST_DEVICE_ID}/update`;
      const testMessage = TEST_MESSAGES.LOG_MESSAGE;

      const waitForLogPromise = waitForLog(/Wrote 2 points to InfluxDB/i)

      mqttClient.publish(deviceTopic, JSON.stringify(testMessage));

      await waitForLogPromise

      // Query InfluxDB for battery detail data
      const query = `
        from(bucket: "${TEST_CONFIG.influx.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_battery_detail")
          |> filter(fn: (r) => r["device_id"] == "${TEST_DEVICE_ID}")
          |> sort(columns: ["_time"], desc: true)
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

      expect(rows).toHaveLength(13) // Updated for new voltage/current fields

      // Check original mV/mA fields
      const voltageRow = rows.find(r => r._field === 'voltage_mv');
      const tempRow = rows.find(r => r._field === 'temperature');
      const percentRow = rows.find(r => r._field === 'percentage');
      const currentRow = rows.find(r => r._field === 'current_ma');

      expect(voltageRow).toBeDefined();
      expect(voltageRow._value).toBe(20182);

      expect(tempRow).toBeDefined();
      expect(tempRow._value).toBe(24);

      expect(percentRow).toBeDefined();
      expect(percentRow._value).toBe(94);
      
      expect(currentRow).toBeDefined();
      expect(currentRow._value).toBe(1538);

      // Check converted V/A fields
      const voltageConvertedRow = rows.find(r => r._field === 'voltage');
      const currentConvertedRow = rows.find(r => r._field === 'current');
      const minCellVoltageRow = rows.find(r => r._field === 'min_cell_voltage');
      const maxCellVoltageRow = rows.find(r => r._field === 'max_cell_voltage');

      expect(voltageConvertedRow).toBeDefined();
      expect(voltageConvertedRow._value).toBe(20.182);

      expect(currentConvertedRow).toBeDefined();
      expect(currentConvertedRow._value).toBe(1.538);

      expect(minCellVoltageRow).toBeDefined();
      expect(minCellVoltageRow._value).toBe(3.995);

      expect(maxCellVoltageRow).toBeDefined();
      expect(maxCellVoltageRow._value).toBe(4.003);
    }, 30000);

    it('should process app topic messages', async () => {
      const appTopic = `/app/${TEST_APP_ID}/get`;
      const testMessage = TEST_MESSAGES.APP_MESSAGE;

      const waitForLogPromise = waitForLog( /Wrote 4 points to InfluxDB/i)

      mqttClient.publish(appTopic, JSON.stringify(testMessage));

      await waitForLogPromise

      // Query InfluxDB for app message data
      const query = `
        from(bucket: "${TEST_CONFIG.influx.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_power")
          |> filter(fn: (r) => r["device_id"] == "${testMessage.deviceSn}")
          |> filter(fn: (r) => r["_field"] == "battery_percentage")
          |> sort(columns: ["_time"], desc: true)
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

      expect(rows).toHaveLength(1)
      expect(rows[0]._value).toBe(testMessage.power);
    }, 30000);

    it('should handle malformed messages gracefully', async () => {
      const deviceTopic = `/device/${TEST_DEVICE_ID}/update`;

        const waitForErrorLogPromise = waitForLog(/Failed to parse/i)

      // Send invalid JSON first
      mqttClient.publish(deviceTopic, 'invalid json message');

        await waitForErrorLogPromise

      const waitForLogPromise = waitForLog( /Wrote 4 points to InfluxDB/i)

      // Send valid message after invalid one
      const testMessage = TEST_MESSAGES.STATUS_UPDATE;
      mqttClient.publish(deviceTopic, JSON.stringify(testMessage));

        await waitForLogPromise

      // Verify service still processes valid messages after receiving invalid ones
      const query = `
        from(bucket: "${TEST_CONFIG.influx.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_mode")
          |> filter(fn: (r) => r["device_id"] == "${TEST_DEVICE_ID}")
          |> sort(columns: ["_time"], desc: true)
          |> limit(n: 1)
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
    }, 30000);

    it('should track connection health', async () => {

      // Send multiple messages to ensure service is active
      for (let i = 0; i < 3; i++) {
        const waitForLogPromise = waitForLog( /Wrote 4 points to InfluxDB/i)
        const message = { ...TEST_MESSAGES.STATUS_UPDATE, mode: i };
        mqttClient.publish(`/device/${TEST_DEVICE_ID}/update`, JSON.stringify(message));
        await waitForLogPromise
      }

      // Query connection tracking data
      const query = `
        from(bucket: "${TEST_CONFIG.influx.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "sunseeker_connection")
          |> filter(fn: (r) => r["device_id"] == "${TEST_DEVICE_ID}")
          |> sort(columns: ["_time"], desc: true)
          |> limit(n: 1)
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

      expect(rows).toHaveLength(1);
      expect(rows[0]._value).toBe(true)
    }, 30000);
  });

  async function waitForLog(expectedLog, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          serviceLogStream.off("data", onData);
          reject(new Error('Timeout waiting for log message'));
        }, timeoutMs);
        function onData(chunk) {
          const log = chunk.toString('utf8');
          if (expectedLog instanceof RegExp ? expectedLog.test(log) : log.includes(expectedLog)) {
              clearTimeout(timeoutId);
            serviceLogStream.off("data", onData);
              resolve();
          }
        }
      serviceLogStream.on('data', onData);
    })
  }
});
