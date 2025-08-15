/**
 * Example configuration for enabling command verification on Bath1 only
 * This demonstrates the gradual rollout approach for testing verification in production
 * 
 * To enable verification for Bath1:
 * 1. Copy the lightBath1Controller configuration below
 * 2. Add the commandConfig section to your main config.js
 * 3. Monitor the homy/automation/lightBath1Controller/command_failed topic for failures
 * 4. If stable for 1-2 weeks, gradually enable on Bath2 and Bath3
 */

const featuresPrefix = process.env.FEATURES_TOPIC_PREFIX || 'homy/features'

// Enhanced Bath1 configuration with verification enabled
const lightBath1Controller = {
  type: 'bath-lights',
  door: {
    statusTopic: `${featuresPrefix}/open/bath1_door_open/status`,
  },
  lock: {
    statusTopic: `${featuresPrefix}/lock/bath1_door_lock/status`,
  },
  light: {
    commandTopic: `${featuresPrefix}/light/bath1_ceiling_light/set`,
    statusTopic: `${featuresPrefix}/light/bath1_ceiling_light/status`,
  },
  toggle: {
    type: 'button',
    statusTopic: `${featuresPrefix}/button/bath1_switch_left/status`,
  },
  timeouts: {
    closed: 2 * 60000,    // 2 minutes - accommodate kids + adults
    opened: 12 * 60000,   // 12 minutes - door usually left open
    toggled: 25 * 60000,  // 25 minutes - guest + kid friendly manual override
    unlocked: 3 * 60000,  // 3 minutes - accommodate kids cleanup time
  },
  // NEW: Command verification configuration for Bath1 testing
  commandConfig: {
    verification: 5000,   // 5 second verification timeout (conservative for testing)
    maxRetries: 3,        // 3 retry attempts (standard reliability)
    retryDelay: 1000,     // 1 second between retries (not too aggressive)
  },
  // Enable verbose logging for Bath1 during testing phase
  verbose: true
}

module.exports = {
  // Example showing how to integrate into main bots configuration
  bots: {
    // Bath1 with verification enabled (testing phase)
    lightBath1Controller,
    
    // Bath2 and Bath3 remain unchanged (legacy mode)
    lightBath2Controller: {
      type: 'bath-lights',
      door: {
        statusTopic: `${featuresPrefix}/open/bath2_door_open/status`,
      },
      lock: {
        statusTopic: `${featuresPrefix}/lock/bath2_door_lock/status`,
      },
      light: {
        commandTopic: `${featuresPrefix}/light/bath2_ceiling_light/set`,
        statusTopic: `${featuresPrefix}/light/bath2_ceiling_light/status`,
      },
      toggle: {
        type: 'switch',
        statusTopic: `${featuresPrefix}/switch/bath2_switch_left/status`,
      },
      timeouts: {
        closed: 3 * 60000,    // 3 minutes
        opened: 6 * 60000,    // 6 minutes
        toggled: 25 * 60000,  // 25 minutes
        unlocked: 4 * 60000,  // 4 minutes
      }
      // No commandConfig = legacy mode (direct publish)
    },
    
    lightBath3Controller: {
      type: 'bath-lights',
      door: {
        statusTopic: `${featuresPrefix}/open/bath3_door_open/status`,
      },
      lock: {
        statusTopic: `${featuresPrefix}/lock/bath3_door_lock/status`,
      },
      light: {
        commandTopic: `${featuresPrefix}/light/bath3_ceiling_light/set`,
        statusTopic: `${featuresPrefix}/light/bath3_ceiling_light/status`,
      },
      toggle: {
        type: 'switch',
        statusTopic: `${featuresPrefix}/switch/bath3_switch_left/status`,
      },
      timeouts: {
        closed: 2 * 60000,    // 2 minutes
        opened: 10 * 60000,   // 10 minutes
        toggled: 15 * 60000,  // 15 minutes
        unlocked: 3 * 60000,  // 3 minutes
      }
      // No commandConfig = legacy mode (direct publish)
    }
  }
}

/**
 * MONITORING SETUP FOR BATH1 TESTING:
 * 
 * 1. Subscribe to failure events:
 *    Topic: homy/automation/lightBath1Controller/command_failed
 *    Payload: {reason, attempts, expectedState, actualState, timestamp}
 * 
 * 2. Monitor logs for verification success/failure patterns:
 *    - Look for "command for [reason] verified successfully" messages
 *    - Look for "command verification timeout" messages
 *    - Look for "scheduling retry for [reason]" messages
 * 
 * 3. Performance comparison:
 *    - Bath1 (with verification) vs Bath2/Bath3 (legacy) reliability
 *    - Check if verification adds noticeable delay to user interactions
 * 
 * 4. Success criteria for full rollout:
 *    - Zero critical failures for 1-2 weeks
 *    - Verification timeout rate < 5% (commands succeed within 5 seconds)
 *    - No user complaints about delayed response
 *    - Retry success rate > 90% when initial command fails
 * 
 * ROLLOUT TIMELINE:
 * Week 1-2: Bath1 only (guest bathroom - lowest usage, safest testing)
 * Week 3-4: Add Bath2 (kids bathroom - medium usage)
 * Week 5-6: Add Bath3 (master bathroom - highest usage)
 * 
 * ROLLBACK PLAN:
 * If issues occur, simply remove the commandConfig section from Bath1
 * and restart the automations service - system reverts to legacy mode immediately.
 */