/**
 * Health check functionality for Sunseeker MQTT-InfluxDB service
 */

import { HEALTH_CHECK } from './constants.js';
import { isTimestampRecent } from './utils.js';
import { logger } from './logger.js';

let serviceInstance = null;

/**
 * Perform health check on the service
 * @param {Object} [options] - Options for health check
 * @param {Object} [options.service] - Service instance to check (for testing)
 * @returns {Object} Health check result
 */
export async function performHealthCheck(options = {}) {
  try {
    // Use provided service or get/create one
    const service = options.service || await getServiceInstance();

    const isHealthy = service.isHealthy();
    const metrics = service.getMetrics();
    
    // Determine overall status
    const hasRecentActivity = isTimestampRecent(
      metrics.lastMessageTime, 
      HEALTH_CHECK.RECENT_ACTIVITY_TIMEOUT_MS
    );
    
    let status = HEALTH_CHECK.STATUS.HEALTHY;
    
    if (!isHealthy) {
      status = HEALTH_CHECK.STATUS.UNHEALTHY;
    } else if (!hasRecentActivity) {
      status = HEALTH_CHECK.STATUS.DEGRADED;
    }
    
    return {
      status,
      checks: {
        mqtt_connected: service.isConnected,
        recent_activity: hasRecentActivity
      },
      metrics: {
        messagesProcessed: metrics.messagesProcessed,
        pointsWritten: metrics.pointsWritten,
        lastMessageTime: metrics.lastMessageTime,
        uptime: metrics.uptime
      },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    logger.error('Health check failed', error);
    
    return {
      status: HEALTH_CHECK.STATUS.UNHEALTHY,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get or create service instance
 * @private
 */
async function getServiceInstance() {
  if (!serviceInstance) {
    // Load config for health check
    const config = await loadHealthCheckConfig();
    const { createService } = await import('./mqtt-influx-service.js');
    serviceInstance = await createService(config);
  }
  return serviceInstance;
}

/**
 * Load configuration for health check
 * @private
 */
async function loadHealthCheckConfig() {
  const { loadConfig } = await import('./config.js');
  return loadConfig();
}

// CLI entry point when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  performHealthCheck()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === HEALTH_CHECK.STATUS.HEALTHY ? 0 : 1);
    })
    .catch(error => {
      console.error('Health check failed:', error.message);
      process.exit(1);
    });
}