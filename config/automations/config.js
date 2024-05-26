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

    toggleBedroomLightFromBedroomSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'bedroom_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'bedroom_ceiling_light' },
      outputConfig: { initialState: false },
    },
    toggleBorisLightFromBorisSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'boris_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'boris_ceiling_light' },
      outputConfig: { initialState: false },
    },
    toggleGerganaLightFromGerganaSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'gergana_switch_right' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'gergana_ceiling_light' },
      outputConfig: { initialState: false },
    },
    toggleMartinLightFromMartinSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'martin_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'martin_ceiling_light' },
      outputConfig: { initialState: false },
    },

    toggleKitchenLightFromKitchenSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'corridor1_kitchen_right' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'kitchen_all_ceiling_lights' },
      outputConfig: { initialState: false },
    },
    toggleLivingroomLightFromLivingroomSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'living_main_right' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'livingroom_ceiling_light' },
      outputConfig: { initialState: false },
    },
    toggleOfficeLightFromOfficeButton: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'office_main_right' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'office_ceiling_light' },
      outputConfig: { initialState: false },
    },

    toggleCorridor1LightFromKitchenButton: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'corridor1_kitchen_left' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'corridor1_ceiling_light' },
      outputConfig: { initialState: false },
    },
    toggleCorridor1LightFromOfficeButton: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'office_main_left' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'corridor1_ceiling_light' },
      outputConfig: { initialState: false },
    },

    toggleCorridor2LightFromLaundrySwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'corridor2_laundry_right' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'corridor2_both_ceiling_lights' },
      outputConfig: { initialState: false },
    },
    toggleCorridor2LightFromBorisSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'boris_switch_right' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'corridor2_both_ceiling_lights' },
      outputConfig: { initialState: false },
    },
    toggleCorridor2LightFromGerganaSwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'switch', name: 'gergana_switch_left' },
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'corridor2_both_ceiling_lights' },
      outputConfig: { initialState: false },
    },
    toggleCorridor2LightFromMartinButton: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'martin_button_right' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'corridor2_both_ceiling_lights' },
      outputConfig: { initialState: false },
    },

    toggleLaundryLightFromLaundrySwitch: {
      type: 'feature-toggle-on-feature-change',
      inputFeature: { type: 'button', name: 'corridor2_laundry_left' },
      inputFilter: 'identity',
      toggleConfig: { timeout: 1000 },
      outputFeature: { type: 'light', name: 'laundry_ceiling_light' },
      outputConfig: { initialState: false },
    },

    lightBath1Controller: {
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
        statusTopic: `${featuresPrefix}/button/bath1_switch_left/status`,
      },
      timeouts: {
        closed: 0.5 * 60000,
        opened: 5 * 60000,
        toggled: 12 * 60000,
        unlocked: 15 * 60000,
      }
    },
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
        statusTopic: `${featuresPrefix}/button/bath2_switch_left/status`,
      },
      timeouts: {
        closed: 0.5 * 60000,
        opened: 5 * 60000,
        toggled: 12 * 60000,
        unlocked: 15 * 60000,
      }
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
        statusTopic: `${featuresPrefix}/button/bath3_switch_left/status`,
      },
      timeouts: {
        closed: 0.5 * 60000,
        opened: 5 * 60000,
        toggled: 12 * 60000,
        unlocked: 15 * 60000,
      }
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
    boilerOnSchedule: {
      type: 'solar-emitter',
      statusTopic: 'homy/features/relay/service_boiler_contactor/status',
      commandTopic: 'homy/features/relay/service_boiler_contactor/set',
      stateParser: ({ state }) => state,
      commandTemplate: (state) => ({ state }),
      lat: 42.1354,
      lon: 24.7453,
      solarTimeStates: {
        goldenHour: true,
        nadir: false
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

    irrigationFlowerGroundSchedule: {
      type: 'irrigation',
      schedule: '0 */10 8-18 * * *',
      duration: 5*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_flower_ground/set`,
    },
    irrigationFlowerPotsSchedule: {
      type: 'irrigation',
      schedule: '0 25,55 6-22 * * *',
      duration: 2*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_flower_pots/set`,
    },
    irrigationGrassPergolaSchedule: {
      type: 'irrigation',
      schedule: '0 0 2 * * *',
      duration: 20*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_grass_pergola/set`,
    },
    timeoutStopIrrigationGrassPergola: {
      type: 'timeout-emit',
      listenTopic: `${featuresPrefix}/relay/irrigation_grass_pergola/status`,
      listenFilter: (payload) => payload.state,
      timeout: 25 * 60000,
      emitTopic: `${featuresPrefix}/relay/irrigation_grass_pergola/set`,
      emitValue: { state: false }
    },
    irrigationGrassNorthWestSchedule: {
      type: 'irrigation',
      schedule: '0 25 2 * * *',
      duration: 20*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_grass_north_west/set`,
    },
    timeoutStopIrrigationGrassNorthWest: {
      type: 'timeout-emit',
      listenTopic: `${featuresPrefix}/relay/irrigation_grass_north_west/status`,
      listenFilter: (payload) => payload.state,
      timeout: 25 * 60000,
      emitTopic: `${featuresPrefix}/relay/irrigation_grass_north_west/set`,
      emitValue: { state: false }
    },
    irrigationGrassWestCenterSchedule: {
      type: 'irrigation',
      schedule: '0 50 2 * * *',
      duration: 20*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_grass_west_center/set`,
    },
    timeoutStopIrrigationGrassWestCenter: {
      type: 'timeout-emit',
      listenTopic: `${featuresPrefix}/relay/irrigation_grass_west_center/status`,
      listenFilter: (payload) => payload.state,
      timeout: 25 * 60000,
      emitTopic: `${featuresPrefix}/relay/irrigation_grass_west_center/set`,
      emitValue: { state: false }
    },
    irrigationGrassNorthWestSchedule2: {
      type: 'irrigation',
      schedule: '0 15 3 * * *',
      duration: 20*60*1000,
      valveControlTopic: `${featuresPrefix}/irrigation_grass_north_west/set`,
    },
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}
