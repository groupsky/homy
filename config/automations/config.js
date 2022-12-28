const featuresPrefix = process.env.FEATURES_TOPIC_PREFIX || 'homy/features'
const haPrefix = process.env.HA_TOPIC_PREFIX || 'homeassistant'

const devices = {
  boiler: {
    identifiers: 'boiler_eldom_200l',
    manufacturer: 'eldom',
    model: '200l',
    name: 'boiler',
    suggested_area: 'Сервизно'
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

    toggleBath2LightFromBath2Switch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'bath2_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'bath2_ceiling_light' },
      initialOutputState: false,
    },
    toggleBedroomLightFromBedroomSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'bedroom_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'bedroom_ceiling_light' },
      initialOutputState: false,
    },
    toggleBorisLightFromBorisSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'boris_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'boris_ceiling_light' },
      initialOutputState: false,
    },
    toggleGerganaLightFromGerganaSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'gergana_switch_right' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'gergana_ceiling_light' },
      initialOutputState: false,
    },
    toggleMartinLightFromMartinSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'martin_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'martin_ceiling_light' },
      initialOutputState: false,
    },

    toggleOfficeLightFromOfficeButton: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'office_main_right' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'office_ceiling_light' },
      initialOutputState: false,
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
        value_template: '{{ value_json.tot | float(default=0) }}',
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
        value_template: '{{ \'ON\' if value_json.p|float(default=0) > 10 else \'OFF\' }}'
      }
    },

    timeoutStopIrrigationGrassNorthWest: {
      type: 'timeout-emit',
      listenTopic: `${featuresPrefix}/relay/irrigation_grass_north_west/status`,
      listenFilter: (payload) => payload.state,
      timeout: 25 * 60000,
      emitTopic: `${featuresPrefix}/relay/irrigation_grass_north_west/set`,
      emitValue: { state: false }
    },

    timeoutStopIrrigationGrassPergola: {
      type: 'timeout-emit',
      listenTopic: `${featuresPrefix}/relay/irrigation_grass_pergola/status`,
      listenFilter: (payload) => payload.state,
      timeout: 15 * 60000,
      emitTopic: `${featuresPrefix}/relay/irrigation_grass_pergola/set`,
      emitValue: { state: false }
    },
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}
