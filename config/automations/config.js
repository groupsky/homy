const featuresPrefix = process.env.FEATURES_TOPIC_PREFIX || 'homy/features'
const haPrefix = process.env.HA_TOPIC_PREFIX || 'homeassistant'

// House location for the sunset/sunrise lights. It comes from the real .env
// (the same values as the weather service) and is never committed. A missing
// value gives NaN, and the solar-emitter bots then log an error and stay off.
const coordinate = (value) => (value && value.trim() !== '' ? Number(value) : NaN)
const houseLocation = {
  lat: coordinate(process.env.WEATHER_LATITUDE),
  lon: coordinate(process.env.WEATHER_LONGITUDE)
}

const devices = {
  boiler: {
    identifiers: 'boiler_eldom_200l',
    manufacturer: 'eldom',
    model: '200l',
    name: 'boiler',
    suggested_area: 'Сервизно'
  },
}

// TV IR codes for living room IR blaster. Only power is used: the TV no longer
// makes the sound, so its volume codes are kept only for the day the audio goes
// back to HDMI.
const tvLivingIrCodes = {
  volumeUp: 'BgMjhxFgAi6gAQOdBi4CwAHgARUBLgJAF0ADQAFAB+AHA0ABQBPgAwHgBz9AAUAj4AsDBymcAyP0CC4C',
  volumeDown: 'Bj8jexFqAiQgAUAFA5QGJALgAwFAE0ABQBdAA0APQAfgDwOAAUAlASQCgAVAAUAJQAMEJAKUBmogA8AHQAuAAwcCnD8jjAhqAg==',
  power: 'BUAjkREyAsABA5UGMgLgAwECagIyYAFAF0ADQAFAB+AHA+ADAUAb4AcBQBPAA0ABwAvABw8dnEAjuQgyAv//QCO5CDIC'
}
const tvLivingIrTopic = 'z2m/house1/ir-living/set/ir_code_to_send'
// The media computer drives the living-room speakers; an agent on it subscribes
// here and takes a bare `up` or `down` as one volume step. It retains
// `{"volume": 0-100, "muted": bool}` on homy/media/living/volume/state.
const livingVolumeCommandTopic = 'homy/media/living/volume/command'

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
    // Keeps the solar controller's clock on local time, summer time included.
    // It writes only the clock registers (#1752).
    syncSolarHeaterClock: {
      type: 'sr04-sync-clock',
      topic: '/modbus/monitoring/solar_heater'
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
        toggledOff: 5000,     // 5 seconds - the door contact is debounced 2 s, so its change can come after the wall switch press
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
      lat: houseLocation.lat,
      lon: houseLocation.lon,
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
      lat: houseLocation.lat,
      lon: houseLocation.lon,
      solarTimeStates: {
        sunset: true,
        sunrise: false
      },
      verbose: false
    },
    haBoilerEnergyMeter: {
      type: 'mqtt-publish',
      topic: 'homeassistant/sensor/boiler-energy-meter/config',
      // Retained, so HA finds the entity again after a restart (#1712)
      retain: true,
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
      retain: true,
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

    // Life-safety alerts on the hall siren (#1770, docker/automations/docs/
    // safety-siren.md). The owner approved the alert table on 2026-10-16.
    // Only the tank row has a sensor today: smoke, CO and water leak wait for
    // sensors, and the heat-pump freeze row waits for a signal.
    safetySiren: {
      type: 'safety-siren',
      siren: {
        stateTopic: 'z2m/house1/floor1-alarm',
        commandTopic: 'z2m/house1/floor1-alarm/set'
      },
      alerts: [
        {
          name: 'tank_overheat',
          label: 'Tank over 85 °C',
          // SR-04 t2, the top of the tank: about one reading a second
          topic: `${featuresPrefix}/sensor/temperature_boiler_high/status`,
          above: 85,
          confirmMs: 2 * 60 * 1000,
          // The sensor sends about once a second, so 60 s without a reading
          // means the data stopped
          maxAgeMs: 60 * 1000,
          // Day only at first; night after some weeks of real data (owner, 2026-10-16)
          dayOnly: true,
          melody: 6,          // High Pitch Siren
          volume: 'high',
          durationSec: 60,
          times: 3,
          pauseSec: 60
        }
      ],
      // The hall wall buttons. A press while the siren sounds stops it, and
      // also toggles that button's light, as always.
      stopButtonTopics: [
        `${featuresPrefix}/button/corridor1_kitchen_left/status`,
        `${featuresPrefix}/button/corridor1_kitchen_right/status`
      ],
      stopTopic: `${featuresPrefix}/button/safety_siren_stop/trigger`,
      test: {
        topic: `${featuresPrefix}/button/safety_siren_test/trigger`,
        melody: 6,
        volume: 'high',
        durationSec: 30
      },
      mute: {
        commandTopic: `${featuresPrefix}/switch/safety_siren_mute/set`,
        statusTopic: `${featuresPrefix}/switch/safety_siren_mute/status`,
        maxMs: 2 * 60 * 60 * 1000
      },
      // The same hours as the Telegram quiet hours (docker/telegram-bridge/CLAUDE.md)
      day: { fromHour: 7, toHour: 23, timeZone: 'Europe/Sofia' },
      aliveMaxAgeMs: 3 * 60 * 60 * 1000
    },

    heatPumpCirculationPowerCycle: {
      type: 'power-cycle-on-low-power',
      powerMonitor: {
        statusTopic: '/modbus/tetriary/heat_pump/reading',
        powerField: 'b_ap',      // Phase B active power, W
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

    // 1217-mariboli switches mains to the UPS in front of a server. Its settings
    // are held in the relay itself; re-assert them whenever it comes online - on
    // automations start (availability is retained), on every zigbee2mqtt start
    // and when the relay comes back - so this file, not the relay's memory, is
    // the record. None of these writes toggles the relay.
    // - power_on_behavior 'on': the UPS gets mains back after an outage
    // - delayed_power_on_state false: no wait on battery after a supply blip
    // - inching auto-ON 1800 s after any OFF, enforced inside the relay even when
    //   zigbee2mqtt or Home Assistant is down. inching_mode 'ON' is "turn back on
    //   after off" - on firmware 1.0.1 an OFF with 10 s inching reported ON again
    //   9.9 s later (2026-09-11). 1800 s stands until the UPS runtime is measured.
    mariboliRelaySettings: {
      type: 'mqtt-transform',
      inputTopic: 'z2m/house1/1217-mariboli/availability',
      filterInput: (payload) => payload?.state === 'online',
      // plain: the json writer adds _bot/_tz, which zigbee2mqtt logs as errors
      transform: () => JSON.stringify({
        power_on_behavior: 'on',
        delayed_power_on_state: false,
        inching_control_set: {
          inching_control: 'ENABLE',
          inching_time: 1800,
          inching_mode: 'ON'
        }
      }),
      outputTopic: 'z2m/house1/1217-mariboli/set',
      outputContent: 'plain',
    },

    // Living-room volume goes to the media computer, TV power to the TV over IR
    // Physical button triggers
    tvLivingVolumeUpFromButton: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/living_main_up/status`,
      filterInput: (payload) => payload && payload.state === true,
      transform: () => 'up',
      outputTopic: livingVolumeCommandTopic,
      outputContent: 'plain',
    },
    tvLivingVolumeDownFromButton: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/living_main_down/status`,
      filterInput: (payload) => payload && payload.state === true,
      transform: () => 'down',
      outputTopic: livingVolumeCommandTopic,
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

    // Home Assistant button triggers
    tvLivingVolumeUpFromHA: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/tv_living_volume_up/trigger`,
      filterInput: (payload) => !!payload,
      transform: () => 'up',
      outputTopic: livingVolumeCommandTopic,
      outputContent: 'plain',
    },
    tvLivingVolumeDownFromHA: {
      type: 'mqtt-transform',
      inputTopic: `${featuresPrefix}/button/tv_living_volume_down/trigger`,
      filterInput: (payload) => !!payload,
      transform: () => 'down',
      outputTopic: livingVolumeCommandTopic,
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

    // Living-room thermostat (#1753): sets the heat-pump water target from the
    // living-room temperature, its set point from Home Assistant and the
    // outdoor temperature. The controller keeps its own start/stop band.
    livingRoomThermostat: {
      type: 'virtual-thermostat',
      roomTopic: 'z2m/house1/living-temp-humid',
      outdoorTopic: 'homy/weather/current',
      controllerTopic: '/modbus/monitoring2/heatpump-ctrl/reading',
      controllerWriteTopic: '/modbus/monitoring2/heatpump-ctrl/write',
      setTopic: 'homy/thermostat/living_room/set',
      statusTopic: 'homy/thermostat/living_room/status',
      // Set point in °C, from Home Assistant
      defaultSetPoint: 21.5,
      minSetPoint: 16,
      maxSetPoint: 26,
      setPointStep: 0.5,
      // Fit of last winter's daily data: living = 11.5 + 0.36 × water + 0.12 × outdoor
      model: { intercept: 11.5, perWater: 0.36, perOutdoor: 0.12 },
      // Water °C added for each °C the room is under the set point
      roomGain: 2,
      // Water target in °C: step, lowest and highest
      waterStep: 0.5,
      minWater: 22,
      maxWater: 32,
      // Smallest change worth a write, and the time between writes, so the
      // controller gets 4 writes a day at most. After a set point change,
      // the first check that can write may do so before the time is up.
      minChange: 1,
      checkMs: 10 * 60 * 1000,                 // 10 min
      minWriteIntervalMs: 6 * 60 * 60 * 1000,  // 6 h
      // Older inputs are not used. The room sensor reports on change and at
      // least once an hour, but gaps of 115 min were seen; the controller
      // reports at least every 5 min.
      roomMaxAgeMs: 150 * 60 * 1000,           // 150 min
      controllerMaxAgeMs: 15 * 60 * 1000,      // 15 min
      // A controller target the bot did not write gets one Telegram message.
      // Readings made this soon after the bot's own write may still show the
      // old target, so they are not checked.
      writeSettleMs: 15 * 60 * 1000,           // 15 min
      // Outdoor: the mean of the weather service values of the last 24 h (the
      // model is a fit on daily means). A value counts only when it is up to
      // 1 h old on arrival. When the newest is over 12 h old, the mean of the
      // month, by the rules in docker/weather/CLAUDE.md.
      outdoorMaxAgeMs: 60 * 60 * 1000,         // 1 h
      outdoorMeanMs: 24 * 60 * 60 * 1000,      // 24 h
      outdoorHoldMs: 12 * 60 * 60 * 1000,      // 12 h
      // °C, January..December: means of daily means of the era5_seamless
      // history, 2021–2025
      outdoorMonthlyMeans: [3.7, 5.0, 7.6, 12.3, 16.7, 22.8, 26.1, 25.3, 20.1, 14.0, 9.5, 5.2],
      telegramWebhookUrl: 'http://telegram-bridge:3000/webhook',
    },

    ioniqDtc: {
      type: 'ioniq-dtc',
      storedTopic: 'ioniq/parsed/dtc/stored',
      pendingTopic: 'ioniq/parsed/dtc/pending',
      outputTopic: 'ioniq/parsed/derived/dtc_count',
      telegramWebhookUrl: 'http://telegram-bridge:3000/webhook',
    },
    ioniqTpms: {
      type: 'ioniq-tpms',
      tpmsTopic: 'ioniq/parsed/tpms',
      ambientTopic: 'ioniq/parsed/ambient',
      // temp_excess gating (issue #1415). The four wheel values in a frame are
      // latched independently, so they are only comparable when all of them
      // refreshed close together, and the comparison only means anything while
      // the car is rolling. The cold-pressure signals (psi and bar) are unaffected.
      speedTopics: [
        'ioniq/parsed/bms/2101',                // speed_kph while awake
        'ioniq/parsed/vmcu',                    // speed_kph alongside gear
      ],
      wheelFreshnessWindowMs: 600000,           // 10 min mutual refresh window
      speedMovingKph: 3,                        // above this = rolling (matches ioniq-sessions)
      motionMaxAgeMs: 1800000,                  // 30 min since the car last moved
      speedMaxAgeMs: 3600000,                   // older speed telemetry => motion unknown => fail open
      // Cold-start gate (issue #1479). The under-inflation alerts read
      // tire_<w>_bar_coldstart, published from the first fresh frame a wheel
      // produces after this long a park — and only on the first start of the
      // local day, so an afternoon start off a sun-soaked tyre is skipped.
      // Overnight is far longer than 6 h; shortening this admits tyres that
      // have not yet equilibrated with ambient and reads them high.
      coldstartMinParkMs: 21600000,             // 6 h
    },
    ioniqCellHealth: {
      type: 'ioniq-cell-health',
      cellTopics: [
        'ioniq/parsed/cells/1',
        'ioniq/parsed/cells/33',
        'ioniq/parsed/cells/65',
      ],
      // bms/2101 carries module_temps 1-5 AND the contemporaneous
      // cell_max_v/cell_min_v pair that cell_spread_mv is derived from (#1418).
      bmsTopic: 'ioniq/parsed/bms/2101',
      moduleTemp2Topic: 'ioniq/parsed/bms/2105',
      cellSpreadOutputTopic: 'ioniq/parsed/derived/cell_spread_mv',
      moduleTempSpreadOutputTopic: 'ioniq/parsed/derived/module_temp_spread_c',
      // Cross-frame join gating (issue #1418). The cells/* segments and the two
      // module-temp frames are polled separately and persist across vehicle
      // sleeps, so they are only comparable when their logger timestamps fall
      // inside one window. A full cells cycle completes in ~300 ms.
      segmentFreshnessWindowMs: 600000,         // 10 min, matches ioniq-tpms
    },
    ioniq12vLdc: {
      type: 'ioniq-12v-ldc',
      inputTopic: 'ioniq/parsed/bms/2101',
      ldcOkTopic: 'ioniq/parsed/derived/ldc_ok',
      auxDropTopic: 'ioniq/parsed/derived/aux12v_drop',
    },
    ioniqSessions: {
      type: 'ioniq-sessions',
      bmsTopic: 'ioniq/parsed/bms/2101',        // ignition, speed_kph, soc, hv_kw, aux_12v, cum_* counters, ts
      vmcuTopic: 'ioniq/parsed/vmcu',           // gear (P/N/D/R string), speed_kph — gear is HERE, not bms/2101
      gearParkValue: 'P',                       // verified string 'P' = parked
      odometerTopic: 'ioniq/parsed/odometer',   // km (sparse ~1/82min)
      connectorTopic: 'ioniq/parsed/bcm_b00e',  // charge_connector (sparse corroborator / awake-charge bound)
      ambientTopic: 'ioniq/parsed/ambient',     // optional; ambient_c best-effort
      chargerMeterTopic: '/modbus/monitoring/charger/reading', // charger or-we-526; fields ap(W), act(kWh); home-charge bound + AC kWh
      tripTopic: 'ioniq/derived/trip',
      chargeTopic: 'ioniq/derived/charge',
      parkTopic: 'ioniq/derived/park',
      // thresholds (PROVISIONAL — re-tune after ~2 weeks of history, spec §11)
      speedMovingKph: 3,           // > this = moving (rejects standstill jitter)
      minRestSplitMs: 180000,      // 3 min OBSERVED stationary-awake splits a trip
      restGapMs: 300000,           // 5 min gap = sleep/rest boundary (above the 1-3 min reboot band + 1 min slow cadence)
      rebootMaxGapMs: 300000,      // gaps below this with ignition on both sides = reboot, NOT a rest
      silenceTimeoutMs: 300000,    // 5 min silence closes a trailing session (> reboot band)
      minTripDurationMs: 60000,
      minTripSamples: 3,           // reject degenerate single-sample jitter "trips"
      chargeMinKwh: 0.3,
      chargeMinAh: 1,
      chargeMinSocPct: 2,          // any ⇒ the rest contained a charge
      chargerMeterOnW: 150,        // >150W sustained = charging (0W baseline + 3 tiers 1.2/1.9/2.6kW verified over 2yr)
      chargerMeterOnMinMs: 60000,  // on: >150W sustained >60s
      chargerMeterOffMinMs: 120000, // off: <150W for >2min (rides the multi-step end taper)
      drainMinDurationMs: 3600000, // 1 h min park before %/day drain is meaningful
      maxPlausibleStepKwh: 40,
      maxPlausibleStepKm: 400,
      maxPlausibleStepAh: 150,     // corruption ceilings ONLY (above a full-range trip / bulk charge / above the ~120 Ah pack nominal)
      socField: 'soc',            // 'soc' (dense, default) vs 'soc_display' (dash) — documented switch, §4.1
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

// Each thermostat with a contact bot also gets a bot that writes its wanted
// settings back after the unit restarts (#1796). It reads the same contacts,
// so it leaves the power to the contact bot while one is open.
for (const [botName, bot] of Object.entries(module.exports.bots)) {
  if (bot.type !== 'bac002-toggle-power') continue
  const restoreName = botName.replace(/^toggle(.+)Power$/, 'restore$1State')
  if (restoreName === botName || restoreName in module.exports.bots) throw new Error(`${botName}: a bac002-toggle-power bot is named toggle<Room>Power, and restore<Room>State is not taken`)
  module.exports.bots[restoreName] = {
    type: 'bac002-restore-state',
    bacTopic: bot.bacTopic,
    switches: bot.switches,
  }
}

// Warns by Telegram when a room thermostat looks wrong for the season (#1739).
// It only sends messages and never changes a setting. It is added here so its
// room list is the one the clock sync uses: the room thermostats.
module.exports.bots.thermostatSeasonGuard = {
  type: 'thermostat-season-guard',
  thermostatTopics: Object.values(module.exports.bots)
    .filter((bot) => bot.type === 'bac002-sync-clock')
    .map((bot) => bot.topic),
  // Outdoor temperature from the weather service (internet data, retained,
  // every 15 min). Without it only the cold night check is off.
  outdoorTopic: 'homy/weather/current',
  // Checks that are not made for a room, as `room:check` pairs separated by
  // commas (the room is the last part of its topic). It comes from the real
  // .env and is never committed: it tells which room is kept cold on purpose.
  // Checks: valveOpenLong, lowCoolingTargetTemp, coolingInColdNights.
  skip: process.env.THERMOSTAT_GUARD_SKIP || '',
  // Cooling valve open without a break for longer than this, in these local
  // months, is a problem
  valveOpenMaxMs: 3 * 60 * 60 * 1000,        // 3 h
  valveOpenMonths: [10, 11, 12, 1, 2, 3, 4],
  // A set point under this (°C) in cooling mode keeps the valve open
  minCoolingTargetTemp: 15,
  // Cooling mode after a night with a lowest outdoor temperature under this (°C).
  // The night is from nightStartHour to nightEndHour local time, and counts
  // when it has at least minNightSamples values (15 min apart: 3 h).
  coldNightC: 8,
  nightStartHour: 22,
  nightEndHour: 7,
  minNightSamples: 12,
  // Outdoor data, by the rules in docker/weather/CLAUDE.md: a value older than
  // this on arrival is dropped. When the newest is older than the hold time,
  // the cold night check is skipped.
  outdoorMaxAgeMs: 60 * 60 * 1000,           // 1 h
  outdoorHoldMs: 12 * 60 * 60 * 1000,        // 12 h
  // Longer between two readings of a room: the valve state in between is
  // unknown, so the open time starts again
  readingGapMs: 15 * 60 * 1000,              // 15 min
  timeZone: 'Europe/Sofia',
  telegramWebhookUrl: 'http://telegram-bridge:3000/webhook',
}
