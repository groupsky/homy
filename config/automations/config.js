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

// TV IR codes for living room IR blaster
const tvLivingIrCodes = {
  volumeUp: 'BgMjhxFgAi6gAQOdBi4CwAHgARUBLgJAF0ADQAFAB+AHA0ABQBPgAwHgBz9AAUAj4AsDBymcAyP0CC4C',
  volumeDown: 'Bj8jexFqAiQgAUAFA5QGJALgAwFAE0ABQBdAA0APQAfgDwOAAUAlASQCgAVAAUAJQAMEJAKUBmogA8AHQAuAAwcCnD8jjAhqAg==',
  power: 'BUAjkREyAsABA5UGMgLgAwECagIyYAFAF0ADQAFAB+AHA+ADAUAb4AcBQBPAA0ABwAvABw8dnEAjuQgyAv//QCO5CDIC'
}
const tvLivingIrTopic = 'z2m/house1/ir-living/set/ir_code_to_send'

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
        type: 'button',
        statusTopic: `${featuresPrefix}/button/bath1_switch_left/status`,
      },
      timeouts: {
        closed: 2 * 60000,    // 2 minutes - accommodate kids + adults
        opened: 12 * 60000,   // 12 minutes - door usually left open
        toggled: 25 * 60000,  // 25 minutes - guest + kid friendly manual override
        unlocked: 3 * 60000,  // 3 minutes - accommodate kids cleanup time
      },
      commandConfig: {
        verification: 300,    // 300ms verification timeout
        maxRetries: 3,        // 3 retry attempts (standard reliability)
        retryDelay: 50,       // 50ms between retries
        failureTopic: 'homy/automation/lightBath1Controller/command_failed', // monitoring topic
      },
      verbose: true           // Enable detailed logging for Bath1 testing phase
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
        type: 'switch',
        statusTopic: `${featuresPrefix}/switch/bath2_switch_left/status`,
      },
      timeouts: {
        closed: 3 * 60000,    // 3 minutes - kids take longer
        opened: 6 * 60000,    // 6 minutes - kids might leave door open briefly
        toggled: 25 * 60000,  // 25 minutes - kids forget to turn off lights
        unlocked: 4 * 60000,  // 4 minutes - kids need more transition time
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
        type: 'switch',
        statusTopic: `${featuresPrefix}/switch/bath3_switch_left/status`,
      },
      timeouts: {
        closed: 2 * 60000,    // 2 minutes - adult efficiency
        opened: 10 * 60000,   // 10 minutes - post-shower ventilation
        toggled: 15 * 60000,  // 15 minutes - intentional extended use
        unlocked: 3 * 60000,  // 3 minutes - standard adult transition
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
    nightExternalLightsZ2M: {
      type: 'solar-emitter',
      statusTopic: 'z2m/house1/P5-night-ext-lights',
      commandTopic: 'z2m/house1/P5-night-ext-lights/set',
      stateParser: (payload) => payload.state === 'ON',
      commandTemplate: (state) => ({ state: state ? 'ON' : 'OFF' }),
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

    irrigationFlowerGroundSchedule: {
      type: 'irrigation',
      schedule: '0 */10 9-18 * * *',
      duration: 5*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_flower_ground/set`,
    },
    irrigationFlowerPotsSchedule: {
      type: 'irrigation',
      schedule: '0 25,55 9-20 * * *',
      duration: 2*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_flower_pots/set`,
    },
    /* disable until the new valve is installed
    irrigationGrassPergolaSchedule: {
      type: 'irrigation',
      schedule: '0 0 7 * * *',
      duration: 20*60000,
      valveControlTopic: `${featuresPrefix}/relay/irrigation_grass_pergola/set`,
    },
    */
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
      schedule: '0 50 7 * * *',
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
      schedule: '0 25 7 * * *',
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

    frontDoorAlarm: {
      type: 'door-alarm',
      doorSensor: {
        statusTopic: `${featuresPrefix}/open/front_main_door_open/status`
      },
      alarmDevice: {
        commandTopic: 'z2m/house1/floor1-alarm/set'
      },
      escalationSteps: [
        { delayMs: 60000, durationSec: 10, volume: 'low' },       // 1 min: 10s low volume
        { delayMs: 120000, durationSec: 20, volume: 'medium' },   // 2 min: 20s medium volume
        { delayMs: 180000, durationSec: 60, volume: 'high' }      // 3 min: 60s high volume
      ],
      melody: 8,
      verbose: false
    },

    heatPumpCirculationPowerCycle: {
      type: 'power-cycle-on-low-power',
      powerMonitor: {
        statusTopic: '/modbus/tetriary/heat_pump/reading',
        powerField: 'b_ap',      // Phase B apparent power
        threshold: 30,           // Watts - maximum power for "low power" condition
        durationMs: 180000       // 3 minutes
      },
      controlDevice: {
        commandTopic: 'z2m/house1/circulation-heatpump/set'
      },
      powerCycle: {
        offDurationMs: 5000      // 5 seconds
      },
      verbose: false
    },

    // Safety backup: Turn ON device if it stays OFF for more than 30 seconds
    // Complements the power-based monitoring above
    circulationHeatpumpOffTimeout: {
      type: 'timeout-emit',
      listenTopic: 'z2m/house1/circulation-heatpump',
      listenFilter: (payload) => payload.state === 'OFF',
      timeout: 30000,           // 30 seconds
      emitTopic: 'z2m/house1/circulation-heatpump/set',
      emitValue: { state: 'ON' },
      verbose: false
    },

    // TV IR Control - Physical Button Triggers
    tvLivingVolumeUpFromButton: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/living_main_up/status`,
      filterInput: (payload) => payload && payload.state === true,
      transform: () => tvLivingIrCodes.volumeUp,
      outputTopic: tvLivingIrTopic,
      outputContent: 'plain',
    },
    tvLivingVolumeDownFromButton: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/living_main_down/status`,
      filterInput: (payload) => payload && payload.state === true,
      transform: () => tvLivingIrCodes.volumeDown,
      outputTopic: tvLivingIrTopic,
      outputContent: 'plain',
    },
    tvLivingPowerFromButton: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/living_main_left/status`,
      filterInput: (payload) => payload && payload.state === true,
      transform: () => tvLivingIrCodes.power,
      outputTopic: tvLivingIrTopic,
      outputContent: 'plain',
    },

    // TV IR Control - Home Assistant Button Triggers
    tvLivingVolumeUpFromHA: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/tv_living_volume_up/trigger`,
      filterInput: (payload) => !!payload,
      transform: () => tvLivingIrCodes.volumeUp,
      outputTopic: tvLivingIrTopic,
      outputContent: 'plain',
    },
    tvLivingVolumeDownFromHA: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/tv_living_volume_down/trigger`,
      filterInput: (payload) => !!payload,
      transform: () => tvLivingIrCodes.volumeDown,
      outputTopic: tvLivingIrTopic,
      outputContent: 'plain',
    },
    tvLivingPowerFromHA: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/tv_living_power/trigger`,
      filterInput: (payload) => !!payload,
      transform: () => tvLivingIrCodes.power,
      outputTopic: tvLivingIrTopic,
      outputContent: 'plain',
    },
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
    state: {
      enabled: true,
      dir: process.env.STATE_DIR || '/app/state',
    }
  }
}
