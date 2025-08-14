/**
 * Test automation configuration for Kafka integration tests
 * Features fast timers for rapid testing
 */

// Configuration format expected by automations service
module.exports = {
  bots: {
    'test-bath-lights': {
      type: 'bath-lights',
      
      // Fast timeouts for testing (seconds instead of minutes)
      timeouts: {
        opened: 2000,    // 2 seconds instead of 3 minutes  
        unlocked: 3000,  // 3 seconds instead of 3 minutes
        toggled: 4000    // 4 seconds instead of 5 minutes (note: 'toggled' not 'toggle')
      },
      
      // MQTT topics for test bath
      door: {
        statusTopic: 'homy/features/sensor/test-door/status'
      },
      lock: {
        statusTopic: 'homy/features/lock/test-bath/status'
      },
      toggle: {
        statusTopic: 'homy/features/switch/test-toggle/status',
        type: 'button'  // button type for test
      },
      light: {
        statusTopic: 'homy/features/light/test-bath/status',
        commandTopic: 'homy/features/light/test-bath/command'
      },
      
      // Enable verbose logging for debugging
      verbose: true
    }
  },
  
  gates: {
    mqtt: {
      url: process.env.BROKER || 'mqtt://broker',
      clientId: process.env.MQTT_CLIENT_ID || 'automations-test'
    }
  }
}