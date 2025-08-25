/**
 * Integration tests for MQTT-InfluxDB Sunseeker service
 * Tests the complete flow from MQTT message reception to InfluxDB writing
 */

import { jest } from '@jest/globals';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  TEST_MQTT_CONFIG,
  TEST_INFLUX_CONFIG,
  TEST_MESSAGES,
  TEST_TOPICS,
  TEST_DEVICE_ID
} from '../src/test-constants.js';

// Mock external dependencies
jest.unstable_mockModule('mqtt', () => ({
  default: {
    connect: jest.fn()
  },
  connect: jest.fn()
}));

jest.unstable_mockModule('@influxdata/influxdb-client', () => ({
  InfluxDB: jest.fn(),
  Point: jest.fn()
}));

// Import after mocking
const mqtt = await import('mqtt');
const { InfluxDB, Point } = await import('@influxdata/influxdb-client');
const { SunseekerMqttInfluxService } = await import('../src/mqtt-influx-service.js');

// Set up MSW server for HTTP requests (if needed for health checks, etc.)
const server = setupServer(
  http.get(`${TEST_INFLUX_CONFIG.url}/health`, () => {
    return HttpResponse.json({ status: 'pass' });
  })
);

describe('SunseekerMqttInfluxService Integration Tests', () => {
  let service;
  let mockMqttClient;
  let mockInfluxDB;
  let mockWriteApi;
  let mockQueryApi;

  beforeAll(() => {
    // Start MSW server before all tests
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    // Clean up MSW server
    server.close();
  });

  beforeEach(() => {
    // Reset MSW handlers
    server.resetHandlers();
    // Reset mocks
    jest.clearAllMocks();

    // Mock MQTT client
    mockMqttClient = {
      on: jest.fn((event, handler) => {
        if (event === 'connect') {
          // Trigger connect immediately for tests
          setTimeout(() => handler(), 0);
        }
      }),
      subscribe: jest.fn((topic, callback) => {
        if (callback) setTimeout(() => callback(null), 0);
      }),
      publish: jest.fn(),
      end: jest.fn(),
      connected: true
    };
    mqtt.connect.mockReturnValue(mockMqttClient);
    if (mqtt.default) {
      mqtt.default.connect.mockReturnValue(mockMqttClient);
    }

    // Mock InfluxDB
    mockWriteApi = {
      writePoint: jest.fn(),
      writePoints: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      useDefaultTags: jest.fn()
    };
    mockQueryApi = {
      queryRows: jest.fn()
    };
    mockInfluxDB = {
      getWriteApi: jest.fn().mockReturnValue(mockWriteApi),
      getQueryApi: jest.fn().mockReturnValue(mockQueryApi),
      close: jest.fn()
    };
    InfluxDB.mockReturnValue(mockInfluxDB);

    // Mock Point constructor
    Point.mockImplementation(() => ({
      tag: jest.fn().mockReturnThis(),
      floatField: jest.fn().mockReturnThis(),
      intField: jest.fn().mockReturnThis(),
      stringField: jest.fn().mockReturnThis(),
      booleanField: jest.fn().mockReturnThis(),
      timestamp: jest.fn().mockReturnThis()
    }));

    // Create service instance with test configuration
    service = new SunseekerMqttInfluxService({
      mqtt: TEST_MQTT_CONFIG,
      influx: TEST_INFLUX_CONFIG
    });
  });

  afterEach(async () => {
    if (service) {
      await service.stop();
    }
  });

  describe('Service Initialization', () => {
    it('should connect to MQTT broker with correct configuration', async () => {
      await service.start();

      const connectFn = mqtt.default ? mqtt.default.connect : mqtt.connect;
      expect(connectFn).toHaveBeenCalledWith(TEST_MQTT_CONFIG.url, {
        username: TEST_MQTT_CONFIG.username,
        password: TEST_MQTT_CONFIG.password,
        clientId: expect.stringContaining('sunseeker-mqtt-influx'),
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 30000
      });
    });

    it('should initialize InfluxDB client with correct configuration', async () => {
      await service.start();

      expect(InfluxDB).toHaveBeenCalledWith({
        url: TEST_INFLUX_CONFIG.url,
        token: TEST_INFLUX_CONFIG.token
      });
    });

    it('should subscribe to device and app topics', async () => {
      await service.start();

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(TEST_TOPICS.DEVICE_UPDATE.replace('/update', '/+'), expect.any(Function));
      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(TEST_TOPICS.APP_GET.replace('/get', '/+'), expect.any(Function));
    });
  });

  describe('Message Processing Flow', () => {
    beforeEach(async () => {
      await service.start();
      
      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should process cmd 501 messages and write to InfluxDB', async () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const message = Buffer.from(JSON.stringify(TEST_MESSAGES.STATUS_UPDATE));

      // Simulate message receipt
      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(topic, message);

      // Allow async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockWriteApi.writePoints).toHaveBeenCalled();
      const writtenPoints = mockWriteApi.writePoints.mock.calls[0][0];
      expect(writtenPoints).toHaveLength(4); // mode, power, station, connection points
    });

    it('should process cmd 509 battery log messages', async () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const message = Buffer.from(JSON.stringify(TEST_MESSAGES.LOG_MESSAGE));

      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(topic, message);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockWriteApi.writePoints).toHaveBeenCalled();
      const writtenPoints = mockWriteApi.writePoints.mock.calls[0][0];
      
      // Should have battery detail point 
      expect(writtenPoints).toHaveLength(1);
      // Verify that a Point was created with the right measurement name
      expect(Point).toHaveBeenCalledWith('sunseeker_battery_detail');
    });

    it('should process app topic messages with deviceSn', async () => {
      const topic = TEST_TOPICS.APP_GET;
      const message = Buffer.from(JSON.stringify(TEST_MESSAGES.APP_MESSAGE));

      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(topic, message);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockWriteApi.writePoints).toHaveBeenCalled();
    });

    it('should handle invalid JSON messages gracefully', async () => {
      const topic = TEST_TOPICS.DEVICE_UPDATE;
      const message = Buffer.from('invalid json');

      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      
      // Should not throw
      expect(() => messageHandler(topic, message)).not.toThrow();
      
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not write to InfluxDB for invalid messages
      expect(mockWriteApi.writePoints).not.toHaveBeenCalled();
    });
  });

  describe('Connection Health Monitoring', () => {
    it('should track MQTT connection status', async () => {
      await service.start();

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(service.isHealthy()).toBe(false); // False because no recent messages

      // Test disconnect event
      const disconnectHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'close')[1];
      if (disconnectHandler) disconnectHandler();

      expect(service.isHealthy()).toBe(false);
    });

    it('should handle MQTT errors gracefully', async () => {
      await service.start();

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const errorHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'error')[1];
      const testError = new Error('Connection failed');

      // Should not throw
      if (errorHandler) expect(() => errorHandler(testError)).not.toThrow();
      expect(service.isHealthy()).toBe(false);
    });
  });

  describe('Performance Metrics', () => {
    it('should track message processing metrics', async () => {
      await service.start();
      
      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // Process some messages
      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      
      for (let i = 0; i < 5; i++) {
        const testMessage = { ...TEST_MESSAGES.STATUS_UPDATE, mode: i % 4, power: 95, station: false };
        const message = Buffer.from(JSON.stringify(testMessage));
        if (messageHandler) messageHandler(TEST_TOPICS.DEVICE_UPDATE, message);
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      const metrics = service.getMetrics();
      expect(metrics.messagesProcessed).toBe(5);
      expect(metrics.pointsWritten).toBeGreaterThan(0);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should close MQTT and InfluxDB connections on stop', async () => {
      await service.start();
      await service.stop();

      expect(mockMqttClient.end).toHaveBeenCalled();
      expect(mockWriteApi.close).toHaveBeenCalled();
      expect(mockInfluxDB.close).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle InfluxDB write errors gracefully', async () => {
      await service.start();
      
      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Now set up the error for this specific test
      mockWriteApi.writePoints.mockRejectedValueOnce(new Error('InfluxDB error'));

      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      const testMessage = { ...TEST_MESSAGES.STATUS_UPDATE, mode: 1, power: 85, station: false };
      const message = Buffer.from(JSON.stringify(testMessage));

      // Should not throw even with InfluxDB errors
      expect(() => messageHandler(TEST_TOPICS.DEVICE_UPDATE, message)).not.toThrow();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate MQTT configuration', () => {
      expect(() => {
        new SunseekerMqttInfluxService({
          mqtt: {
            // Missing required fields
          },
          influx: {
            url: 'http://influxdb:8086',
            token: 'token',
            org: 'org',
            bucket: 'bucket'
          }
        });
      }).toThrow('Missing required configuration fields');
    });

    it('should validate InfluxDB configuration', () => {
      expect(() => {
        new SunseekerMqttInfluxService({
          mqtt: TEST_MQTT_CONFIG,
          influx: {
            // Missing required fields
          }
        });
      }).toThrow('Missing required configuration fields');
    });
  });
});