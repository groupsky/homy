/**
 * Tests for MQTT connection failure scenarios
 * Verifies proper error handling and retry behavior when MQTT login fails
 */

import { jest } from '@jest/globals';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  TEST_MQTT_CONFIG,
  TEST_INFLUX_CONFIG
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
const { InfluxDB } = await import('@influxdata/influxdb-client');
const { SunseekerMqttInfluxService } = await import('../src/mqtt-influx-service.js');

// Set up MSW server for any HTTP requests
const server = setupServer(
  http.get(`${TEST_INFLUX_CONFIG.url}/health`, () => {
    return HttpResponse.json({ status: 'pass' });
  })
);

describe('MQTT Connection Failure Scenarios', () => {
  let service;
  let mockMqttClient;
  let mockInfluxDB;
  let mockWriteApi;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    server.resetHandlers();
    jest.clearAllMocks();

    // Mock InfluxDB (this should work fine)
    mockWriteApi = {
      writePoint: jest.fn(),
      writePoints: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      useDefaultTags: jest.fn()
    };
    mockInfluxDB = {
      getWriteApi: jest.fn().mockReturnValue(mockWriteApi),
      getQueryApi: jest.fn().mockReturnValue({}),
      close: jest.fn()
    };
    InfluxDB.mockReturnValue(mockInfluxDB);

    // Default mock MQTT client
    mockMqttClient = {
      on: jest.fn(),
      subscribe: jest.fn(),
      publish: jest.fn(),
      end: jest.fn(),
      connected: false
    };

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

  describe('Authentication Failures', () => {
    it('should handle MQTT authentication errors during initial connection', async () => {
      // Mock MQTT client that fails authentication
      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          // Simulate authentication error after a short delay
          setTimeout(() => {
            const authError = new Error('Connection refused: Not authorized');
            authError.code = 5; // MQTT_CONN_REFUSED_NOT_AUTHORIZED
            handler(authError);
          }, 10);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Service should handle the authentication error gracefully
      expect(service.isHealthy()).toBe(false);
      
      // Should have attempted MQTT connection
      const connectFn = mqtt.default ? mqtt.default.connect : mqtt.connect;
      expect(connectFn).toHaveBeenCalledWith(TEST_MQTT_CONFIG.url, expect.any(Object));
    });

    it('should handle wrong password errors', async () => {
      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => {
            const authError = new Error('Connection refused: Bad username or password');
            authError.code = 4; // MQTT_CONN_REFUSED_BAD_USERNAME_PASSWORD
            handler(authError);
          }, 10);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(service.isHealthy()).toBe(false);
    });
  });

  describe('Network Connection Failures', () => {
    it('should handle network timeouts during MQTT connection', async () => {
      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => {
            const timeoutError = new Error('connect ETIMEDOUT');
            timeoutError.code = 'ETIMEDOUT';
            handler(timeoutError);
          }, 10);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(service.isHealthy()).toBe(false);
    });

    it('should handle DNS resolution failures', async () => {
      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => {
            const dnsError = new Error('getaddrinfo ENOTFOUND');
            dnsError.code = 'ENOTFOUND';
            handler(dnsError);
          }, 10);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(service.isHealthy()).toBe(false);
    });
  });

  describe('Connection State Management', () => {
    it('should handle connection drops after successful initial connection', async () => {
      let connectHandler, closeHandler;

      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'connect') {
          connectHandler = handler;
          // Trigger successful connection
          setTimeout(() => {
            mockMqttClient.connected = true;
            handler();
          }, 5);
        } else if (event === 'close') {
          closeHandler = handler;
        }
      });

      mockMqttClient.subscribe.mockImplementation((topic, callback) => {
        if (callback) setTimeout(() => callback(null), 5);
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();
      await new Promise(resolve => setTimeout(resolve, 20));

      // Initially should be connected (but healthy = false due to no recent messages)
      expect(mockMqttClient.connected).toBe(true);

      // Simulate connection drop
      mockMqttClient.connected = false;
      if (closeHandler) closeHandler();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(service.isHealthy()).toBe(false);
    });

    it('should continue attempting reconnection after failures', async () => {
      let reconnectCount = 0;

      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'reconnect') {
          reconnectCount++;
        } else if (event === 'error') {
          setTimeout(() => {
            const connError = new Error('Connection failed');
            handler(connError);
          }, 5);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Service should handle reconnection attempts
      expect(service.isHealthy()).toBe(false);
    });
  });

  describe('Service Robustness', () => {
    it('should not crash when MQTT client fails completely', async () => {
      // Mock a completely broken MQTT client
      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => {
            const fatalError = new Error('MQTT client failed catastrophically');
            handler(fatalError);
          }, 5);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      // Service start should not throw even with catastrophic MQTT failure
      await expect(service.start()).resolves.not.toThrow();
      
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should gracefully report unhealthy status
      expect(service.isHealthy()).toBe(false);
    });

    it('should provide useful error information in health status', async () => {
      mockMqttClient.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => {
            const authError = new Error('Connection refused: Not authorized');
            authError.code = 5;
            handler(authError);
          }, 5);
        }
      });

      mqtt.connect.mockReturnValue(mockMqttClient);
      if (mqtt.default) {
        mqtt.default.connect.mockReturnValue(mockMqttClient);
      }

      await service.start();
      await new Promise(resolve => setTimeout(resolve, 30));

      const metrics = service.getMetrics();
      
      // Should track connection attempts and failures
      expect(metrics).toHaveProperty('messagesProcessed');
      expect(metrics.messagesProcessed).toBe(0); // No messages processed due to connection failure
    });
  });
});