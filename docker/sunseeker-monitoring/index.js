/**
 * Sunseeker MQTT to InfluxDB Bridge Service
 * 
 * Connects to MQTT broker to receive Sunseeker lawn mower messages
 * and forwards structured data to InfluxDB for monitoring and analysis.
 */

import { loadConfig } from './src/config.js';
import { createService } from './src/mqtt-influx-service.js';

// Global service instance for cleanup
let service = null;

async function main() {
  try {
    console.log('🏠 Starting Sunseeker MQTT-InfluxDB Bridge...');
    
    // Load configuration
    const config = loadConfig();
    
    // Create and start service
    service = await createService(config);
    await service.start();
    
    console.log('✅ Service started successfully');
    console.log('🔄 Processing messages...');
    
    // Keep the process alive
    process.stdin.resume();
    
  } catch (error) {
    console.error('❌ Failed to start service:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(`🛑 Received ${signal}, shutting down gracefully...`);
  
  try {
    if (service) {
      await service.stop();
    }
    console.log('✅ Service stopped successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Start the service
main();