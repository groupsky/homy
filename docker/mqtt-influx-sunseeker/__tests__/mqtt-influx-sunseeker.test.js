/**
 * Integration tests for MQTT-InfluxDB Sunseeker service
 * Tests the complete flow from MQTT message reception to InfluxDB writing
 */

import { jest } from '@jest/globals';

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

describe('SunseekerMqttInfluxService Integration Tests', () => {
  let service;
  let mockMqttClient;
  let mockInfluxDB;
  let mockWriteApi;
  let mockQueryApi;

  beforeEach(() => {
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

    // Create service instance
    service = new SunseekerMqttInfluxService({
      mqtt: {
        url: 'mqtts://mqtts.sk-robot.com:8883',
        username: 'app',
        password: 'h4ijwkTnyrA',
        deviceId: '22031680002700015651',
        appId: '12480368'
      },
      influx: {
        url: 'http://influxdb:8086',
        token: 'test-token',
        org: 'test-org',
        bucket: 'sunseeker'
      }
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
      expect(connectFn).toHaveBeenCalledWith('mqtts://mqtts.sk-robot.com:8883', {
        username: 'app',
        password: 'h4ijwkTnyrA',
        clientId: expect.stringContaining('sunseeker-mqtt-influx'),
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 30000
      });
    });

    it('should initialize InfluxDB client with correct configuration', async () => {
      await service.start();

      expect(InfluxDB).toHaveBeenCalledWith({
        url: 'http://influxdb:8086',
        token: 'test-token'
      });
    });

    it('should subscribe to device and app topics', async () => {
      await service.start();

      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith('/device/22031680002700015651/+', expect.any(Function));
      expect(mockMqttClient.subscribe).toHaveBeenCalledWith('/app/12480368/+', expect.any(Function));
    });
  });

  describe('Message Processing Flow', () => {
    beforeEach(async () => {
      await service.start();
      
      // Allow async operations to complete
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should process cmd 501 messages and write to InfluxDB', async () => {
      const topic = '/device/22031680002700015651/update';
      const message = Buffer.from('{"cmd":501,"mode":3,"power":96,"station":true}');

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
      const topic = '/device/22031680002700015651/update';
      const message = Buffer.from('{"cmd":509,"lv":3,"log":"I/charging [Sun Aug 24 22:58:16 2025] (637)bat vol=20182,min=3995mV,max=4003mV,temp=24,current=1538,percent=94\\n"}');

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
      const topic = '/app/12480368/get';
      const message = Buffer.from('{"mode":3,"station":true,"cmd":501,"power":96,"deviceSn":"22031680002700015651"}');

      const messageHandler = mockMqttClient.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(topic, message);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockWriteApi.writePoints).toHaveBeenCalled();
    });

    it('should handle invalid JSON messages gracefully', async () => {
      const topic = '/device/22031680002700015651/update';
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
        const message = Buffer.from(`{"cmd":501,"mode":${i % 4},"power":95,"station":false}`);
        if (messageHandler) messageHandler('/device/22031680002700015651/update', message);
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
      const message = Buffer.from('{"cmd":501,"mode":1,"power":85,"station":false}');

      // Should not throw even with InfluxDB errors
      expect(() => messageHandler('/device/22031680002700015651/update', message)).not.toThrow();
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
          mqtt: {
            url: 'mqtts://test.com',
            username: 'user',
            password: 'pass',
            deviceId: 'device',
            appId: 'app'
          },
          influx: {
            // Missing required fields
          }
        });
      }).toThrow('Missing required configuration fields');
    });
  });
});