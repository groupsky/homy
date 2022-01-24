module.exports = {
  bots: {
    syncThermostatBedroomClock: {
      type: 'bac002-sync-clock',
      topic: '/modbus/monitoring/thermostat-bedroom'
    },
    syncThermostatBorisClock: {
      type: 'bac002-sync-clock',
      topic: '/modbus/monitoring/thermostat-boris'
    },
    syncThermostatGerganaClock: {
      type: 'bac002-sync-clock',
      topic: '/modbus/monitoring/thermostat-gergana'
    },
    syncThermostatMartinClock: {
      type: 'bac002-sync-clock',
      topic: '/modbus/monitoring/thermostat-martin'
    },
    toggleThermostatBedroomPower: {
      type: 'bac002-toggle-power',
      bacTopic: '/modbus/monitoring/thermostat-bedroom',
      switches: [
        // door
        { topic: '/modbus/dry-switches/mbsl32di1/reading', isOpen: ({ inputs }) => !(inputs & (1 << 26)) },
        // window
        { topic: '/modbus/dry-switches/mbsl32di1/reading', isOpen: ({ inputs }) => !(inputs & (1 << 27)) },
      ]
    },
    toggleThermostatBorisPower: {
      type: 'bac002-toggle-power',
      bacTopic: '/modbus/monitoring/thermostat-boris',
      switches: [
        // door
        { topic: '/modbus/dry-switches/mbsl32di1/reading', isOpen: ({ inputs }) => !(inputs & (1 << 31)) },
        // window
        { topic: '/modbus/dry-switches/mbsl32di2/reading', isOpen: ({ inputs }) => !(inputs & (1 << 1)) },
      ]
    },
    toggleThermostatGerganaPower: {
      type: 'bac002-toggle-power',
      bacTopic: '/modbus/monitoring/thermostat-gergana',
      switches: [
        // door
        { topic: '/modbus/dry-switches/mbsl32di1/reading', isOpen: ({ inputs }) => !(inputs & (1 << 30)) },
        // window
        { topic: '/modbus/dry-switches/mbsl32di2/reading', isOpen: ({ inputs }) => !(inputs & (1 << 0)) },
      ]
    },
    toggleThermostatMartinPower: {
      type: 'bac002-toggle-power',
      bacTopic: '/modbus/monitoring/thermostat-martin',
      switches: [
        // west window
        { topic: '/modbus/dry-switches/mbsl32di1/reading', isOpen: ({ inputs }) => !(inputs & (1 << 28)) },
        // south window
        { topic: '/modbus/dry-switches/mbsl32di1/reading', isOpen: ({ inputs }) => !(inputs & (1 << 29)) },
      ]
    },
    toggleBath2Light: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di2/reading',
      mask: 1 << 5,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 16, value: -1 }
    },
    toggleBedroomLight: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di2/reading',
      mask: 1 << 7,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 17, value: -1 }
    },
    toggleBorisLight: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di2/reading',
      mask: 1 << 10,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 64, value: -1 }
    },
    toggleGerganaLight: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di2/reading',
      mask: 1 << 13,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 63, value: -1 }
    },
    toggleMartinLight: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di2/reading',
      mask: 1 << 9,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 18, value: -1 }
    },
    lightOnBath1OnLock: {
      type: 'emit-on-di',
      diTopic: '/modbus/dry-switches/mbsl32di1/reading',
      di: 5,
      value: true,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 19, value: 1 }
    },
    lightOnBath2OnLock: {
      type: 'emit-on-di',
      diTopic: '/modbus/dry-switches/mbsl32di1/reading',
      di: 9,
      value: true,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 16, value: 1 }
    }
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}
