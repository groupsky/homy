#!/usr/bin/env node

/**
 * Standalone health check script for Docker healthcheck
 * Usage: node health-check.js
 * Exit codes: 0 = healthy, 1 = unhealthy
 */

import { performHealthCheck } from './src/health-check.js';

async function main() {
  try {
    const healthResult = await performHealthCheck();
    
    console.log(`Health status: ${healthResult.status}`);
    
    if (healthResult.checks) {
      console.log('Checks:');
      Object.entries(healthResult.checks).forEach(([check, status]) => {
        const icon = status ? '✅' : '❌';
        console.log(`  ${icon} ${check}: ${status}`);
      });
    }
    
    if (healthResult.metrics) {
      console.log('Metrics:');
      console.log(`  Messages processed: ${healthResult.metrics.messagesProcessed}`);
      console.log(`  Points written: ${healthResult.metrics.pointsWritten}`);
      console.log(`  Last message: ${healthResult.metrics.lastMessageTime ? new Date(healthResult.metrics.lastMessageTime).toISOString() : 'Never'}`);
      console.log(`  Uptime: ${Math.floor(healthResult.metrics.uptime / 1000)}s`);
    }
    
    // Exit with appropriate code
    if (healthResult.status === 'healthy') {
      process.exit(0);
    } else {
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

main();