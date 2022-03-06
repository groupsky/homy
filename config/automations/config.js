const areas = {
  bath1: 'Баня 1',
  bath2: 'Баня 2',
  bath3: 'Баня 3',
  external: 'Вън'
}

const devices = {
  bath1: {
    identifiers: 'device_area_bath1',
    name: 'Баня 1',
    suggested_area: areas.bath1
  },

  bath2: {
    identifiers: 'device_area_bath2',
    name: 'Баня 2',
    suggested_area: areas.bath2
  },

  bath3: {
    identifiers: 'device_area_bath3',
    name: 'Баня 3',
    suggested_area: areas.bath3
  },

  boiler: {
    identifiers: 'boiler_eldom_200l',
    manufacturer: 'eldom',
    model: '200l',
    name: 'boiler',
  },

  veranda: {
    identifiers: 'device_veranda',
    name: 'Веранда',
    suggested_area: areas.external
  }
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
    lightOnBath1OnOpen: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di1/reading',
      mask: 1 << 6,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 19, value: 1 },
      filterState: (newState) => !newState
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
    lightOnBath2OnLock: {
      type: 'emit-on-di',
      diTopic: '/modbus/dry-switches/mbsl32di1/reading',
      di: 9,
      value: true,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 16, value: 1 }
    },
    lightOnBath2OnOpen: {
      type: 'emit-on-di-change',
      diTopic: '/modbus/dry-switches/mbsl32di1/reading',
      mask: 1 << 10,
      outputTopic: '/homy/ard1/output',
      outputMessage: { pin: 16, value: 1 },
      filterState: (newState) => !newState
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
    bath1Door: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 6)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_1_door',
        config: {
          name: 'Врата',
          device: devices.bath1,
          device_class: 'door',
          object_id: 'bath1_door',
          unique_id: 'bot_bath1_door',
        }
      }
    },
    bath1DoorLock: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 5)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_1_door_lock',
        config: {
          name: 'Врата',
          device: devices.bath1,
          device_class: 'lock',
          object_id: 'bath1_door_lock',
          unique_id: 'bot_bath1_door_lock',
        }
      }
    },
    bath1Window: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 19)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_1_window',
        config: {
          name: 'Прозорец',
          device: devices.bath1,
          device_class: 'window',
          object_id: 'bath1_window',
          unique_id: 'bot_bath1_window',
        }
      }
    },
    bath2Door: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 10)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_2_door',
        config: {
          name: 'Врата',
          device: devices.bath2,
          device_class: 'door',
          object_id: 'bath2_door',
          unique_id: 'bot_bath2_door',
        }
      }
    },
    bath2DoorLock: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 9)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_2_door_lock',
        config: {
          name: 'Врата',
          device: devices.bath2,
          device_class: 'lock',
          object_id: 'bath2_door_lock',
          unique_id: 'bot_bath2_door_lock',
        }
      }
    },
    bath2Window: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 25)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_2_window',
        config: {
          name: 'Прозорец',
          device: devices.bath2,
          device_class: 'window',
          object_id: 'bath2_window',
          unique_id: 'bot_bath2_window',
        }
      }
    },
    bath3Door: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 12)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_3_door',
        config: {
          name: 'Врата',
          device: devices.bath3,
          device_class: 'door',
          object_id: 'bath3_door',
          unique_id: 'bot_bath3_door',
        }
      }
    },
    bath3DoorLock: {
      type: 'binary-sensor',
      stateTopic: '/modbus/dry-switches/mbsl32di1/reading',
      stateParser: ({ inputs }) => !(inputs & (1 << 11)),
      ha: {
        enabled: true,
        topic: 'homeassistant/binary_sensor/bath_3_door_lock',
        config: {
          name: 'Врата',
          device: devices.bath3,
          device_class: 'lock',
          object_id: 'bath3_door_lock',
          unique_id: 'bot_bath3_door_lock',
        }
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
