module.exports = {
  bots: {
    'door-entry-counter': {
      type: 'stateful-counter',
      incrementTopic: '/sensors/door/entry',
      resetTopic: '/admin/counters/door/reset',
      statusTopic: '/admin/counters/door/status',
      outputTopic: '/counters/door/state'
    },

    'motion-detector-counter': {
      type: 'stateful-counter',
      incrementTopic: '/sensors/motion/detected',
      outputTopic: '/counters/motion/state'
    },

    'button-press-counter': {
      type: 'stateful-counter',
      incrementTopic: '/buttons/+/pressed',
      resetTopic: '/admin/counters/buttons/reset',
      statusTopic: '/admin/counters/buttons/status',
      outputTopic: '/counters/buttons/state'
    }
  },

  gates: {
    mqtt: {
      url: process.env.BROKER || 'mqtt://localhost',
      clientId: process.env.MQTT_CLIENT_ID || 'stateful-example'
    },
    state: {
      enabled: true,
      dir: process.env.STATE_DIR || '/app/state',
      debounceMs: 100
    }
  }
}
