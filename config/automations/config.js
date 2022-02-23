const devices = {
  boiler: {
    identifiers: 'boiler_eldom_200l',
    manufacturer: 'eldom',
    model: '200l',
    name: 'boiler',
    sw_version: '1.0.0',
  },
}

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
    },
    autoLightOffBath1: {
      type: 'timeout-lights-off',
      lockedTopic: '/modbus/dry-switches/mbsl32di1/reading',
      lockedDi: 5,
      lockedValue: true,
      timeout: 12 * 60000,
      unlockTimeout: 60000,
      pin: 19
    },
    autoLightOffBath2: {
      type: 'timeout-lights-off',
      lockedTopic: '/modbus/dry-switches/mbsl32di1/reading',
      lockedDi: 9,
      lockedValue: true,
      timeout: 12 * 60000,
      unlockTimeout: 60000,
      pin: 16
    },
    nightExternalLights: {
      type: 'solar-emitter',
      statusTopic: '/modbus/dry-switches/relays00-15/reading',
      commandTopic: '/modbus/dry-switches/relays00-15/write',
      stateParser: ({ outputs }) => outputs & 1 << 15,
      commandTemplate: (state) => ({ 'out15': state }),
      lat: 42.1354,
      lon: 24.7453,
      solarTimeStates: {
        sunset: true,
        sunrise: false
      },
      verbose: false
    },
    haBoilerSwitch: {
      type: 'mqtt-publish',
      topic: 'homeassistant/switch/boiler-contactor/config',
      payload: {
        name: 'boiler contactor',
        unique_id: 'boiler_contactor',
        device: devices.boiler,
        device_class: 'outlet',

        command_topic: '/modbus/dry-switches/relays00-15/write',
        payload_on: '{"out14": true}',
        payload_off: '{"out14": false}',

        state_topic: '/modbus/dry-switches/relays00-15/reading',
        state_off: '0',
        state_on: `${1 << 14}`,
        value_template: `{{- value_json.outputs|bitwise_and(${1 << 14}) -}}`
      }
    },
    haBoilerEnergyMeter: {
      type: 'mqtt-publish',
      topic: 'homeassistant/sensor/boiler-energy-meter/config',
      payload: {
        name: 'boiler energy meter',
        unique_id: 'boiler_energy_meter',
        device: devices.boiler,
        device_class: 'energy',
        state_class: 'total',
        unit_of_measurement: 'kWh',

        state_topic: '/modbus/secondary/boiler/reading',
        value_template: '{{ value_json.tot | float }}',
      }
    },
    haBoilerHeating: {
      type: 'mqtt-publish',
      topic: 'homeassistant/binary_sensor/boiler-heating/config',
      payload: {
        name: 'boiler heating',
        unique_id: 'boiler_status_heating',
        device: devices.boiler,

        state_topic: '/modbus/secondary/boiler/reading',
        value_template: '{{ \'ON\' if value_json.p|float > 10 else \'OFF\' }}'
      }
    },
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}
