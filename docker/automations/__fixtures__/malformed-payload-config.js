/**
 * Minimal `index.js` configuration used by `index.test.js`.
 *
 * One passthrough bot is the smallest thing that registers a real MQTT
 * subscription, which is what the message handler needs in order to dispatch
 * anything at all. A second one publishes to a zigbee2mqtt set topic. State persistence is off so no test touches the filesystem.
 */
module.exports = {
  bots: {
    malformedProbe: {
      type: 'mqtt-transform',
      inputTopic: 'test/malformed/in',
      outputTopic: 'test/malformed/out',
      transform: (payload) => payload
    },
    z2mProbe: {
      type: 'mqtt-transform',
      inputTopic: 'test/z2m/in',
      outputTopic: 'z2m/house1/test-device/set',
      transform: (payload) => payload
    }
  },
  gates: {
    mqtt: {
      url: 'mqtt://test-broker',
      clientId: 'index-test'
    },
    state: {
      enabled: false
    }
  }
}
