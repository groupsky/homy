/**
 * Tests for health check functionality
 */

import { jest } from '@jest/globals';

describe('Health Check', () => {
  let mockService;
  let healthCheck;

  beforeEach(async () => {
    // Mock the service
    mockService = {
      isHealthy: jest.fn(),
      isConnected: false,
      getMetrics: jest.fn()
    };

    // Mock the service import
    jest.unstable_mockModule('../src/mqtt-influx-service.js', () => ({
      createService: jest.fn().mockResolvedValue(mockService)
    }));

    // Import after mocking
    const { performHealthCheck } = await import('./health-check.js');
    healthCheck = performHealthCheck;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should return healthy status when service is healthy', async () => {
    mockService.isHealthy.mockReturnValue(true);
    mockService.isConnected = true;
    mockService.getMetrics.mockReturnValue({
      messagesProcessed: 100,
      pointsWritten: 300,
      lastMessageTime: Date.now() - 5000,
      uptime: 60000
    });

    const result = await healthCheck({ service: mockService });

    expect(result.status).toBe('healthy');
    expect(result.checks.mqtt_connected).toBe(true);
    expect(result.checks.recent_activity).toBe(true);
    expect(result.metrics).toBeDefined();
  });

  it('should return unhealthy status when service is not healthy', async () => {
    mockService.isHealthy.mockReturnValue(false);
    mockService.isConnected = false;
    mockService.getMetrics.mockReturnValue({
      messagesProcessed: 50,
      pointsWritten: 150,
      lastMessageTime: Date.now() - 300000, // 5 minutes ago
      uptime: 60000
    });

    const result = await healthCheck({ service: mockService });

    expect(result.status).toBe('unhealthy');
    expect(result.checks.mqtt_connected).toBe(false);
    expect(result.checks.recent_activity).toBe(false);
  });

  it('should detect stale data when no recent messages', async () => {
    mockService.isHealthy.mockReturnValue(true);
    mockService.isConnected = true;
    mockService.getMetrics.mockReturnValue({
      messagesProcessed: 100,
      pointsWritten: 300,
      lastMessageTime: Date.now() - 600000, // 10 minutes ago
      uptime: 60000
    });

    const result = await healthCheck({ service: mockService });

    expect(result.status).toBe('degraded');
    expect(result.checks.mqtt_connected).toBe(true);
    expect(result.checks.recent_activity).toBe(false);
  });

  it('should handle service creation errors', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await healthCheck(); // Don't provide service to trigger creation error

    expect(result.status).toBe('unhealthy');
    expect(result.error).toContain('Missing required configuration fields');
  });
});
