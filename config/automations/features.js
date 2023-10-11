/* eslint-env node */

const prefix = process.env.TOPIC_PREFIX || 'homy/features'

/**
 * @param {string} name
 * @param {string} inputTopic
 * @param {Array<string|object>} transform
 * @param {string} outputTopic
 * @return {Object}
 */
const state = (
  {
    name,
    input: { topic: inputTopic },
    transform,
    output: { topic: outputTopic },
  }
) => ({
  [`${name}State`]: {
    type: 'transform',
    input: { name: 'inputs/mqtt', params: { topic: inputTopic } },
    transform: [
      ...transform,
      'to_state',
    ].filter(Boolean),
    filterOutput: 'state_not_null',
    output: { name: 'outputs/mqtt', params: { topic: `${prefix}/${outputTopic}/status`, retain: true } }
  },
})

/**
 * @param {string} name
 * @param {string} inputTopic
 * @param {Array<string|object>} transform
 * @param {string} outputTopic
 * @return {Object}
 */
const cmd = (
  {
    name,
    input: { topic: inputTopic },
    transform,
    output: { topic: outputTopic },
  }
) => ({
  [`${name}Cmd`]: {
    type: 'transform',
    input: { name: 'inputs/mqtt', params: { topic: `${prefix}/${inputTopic}/set` } },
    filterInput: 'not_null',
    transform: [
      'from_state',
      ...transform.filter(Boolean)
    ],
    output: { name: 'outputs/mqtt', params: { topic: outputTopic, retain: true } }
  },
})

/**
 *
 * @param {string} name
 * @param {'dry-switches'} [bus]
 * @param {'mbsl32di1'|'mbsl32di2'} device
 * @param {number} bit
 * @param {boolean} invert
 * @param {string} topic
 * @return {Object}
 */
const drySwitch = (
  {
    name,
    bus = 'dry-switches',
    device,
    bit,
    invert = false,
    topic
  }
) => state({
  name,
  input: { topic: `/modbus/${bus}/${device}/reading` },
  transform: [
    { name: 'get_object_key', params: { key: 'inputs' } },
    { name: 'bit_to_bool', params: { bit } },
    invert && 'not'
  ],
  output: { topic }
})

/**
 * @param {string} name
 * @param {'dry-switches'} [bus]
 * @param {'relays00-15'|'relays16-31'} device
 * @param {number} bit
 * @param {boolean} [invert]
 * @param {string} topic
 * @return {Object}
 */
const relay = (
  {
    name,
    bus = 'dry-switches',
    device,
    bit,
    invert = false,
    topic
  }
) => ({
  ...state({
    name,
    input: { topic: `/modbus/${bus}/${device}/reading` },
    transform: [
      { name: 'get_object_key', params: { key: 'outputs' } },
      { name: 'bit_to_bool', params: { bit } },
      invert ? { name: 'not' } : null
    ],
    output: { topic }
  }),
  ...cmd({
    name,
    input: { topic },
    transform: [
      invert ? { name: 'not' } : null,
      { name: 'create_object_key', params: { key: `out${bit}` } }
    ],
    output: { topic: `/modbus/${bus}/${device}/write` }
  }),
})

/**
 *
 * @param {string} name
 * @param {number} pin
 * @param {boolean} [invert]
 * @param {string} topic
 * @return {Object}
 */
const ard1Input = (
  {
    name,
    pin,
    invert = false,
    topic
  }
) => state({
  name,
  input: { topic: '/homy/ard1/input' },
  transform: [
    { name: 'ard1_status', params: { pin, type: 'ic' } },
    invert && 'not'
  ],
  output: { topic }
})

/**
 * @param {string} name
 * @param {number} pin
 * @param {boolean} [invert]
 * @param {string} topic
 * @return {Object}
 */
const ard1Output = (
  {
    name,
    pin,
    invert = false,
    topic
  }
) => ({
  ...state({
    name,
    input: { topic: '/homy/ard1/input' },
    transform: [
      { name: 'ard1_status', params: { pin, type: 'oc' } },
      invert && 'not'
    ],
    output: { topic }
  }),
  ...cmd({
    name,
    input: { topic },
    transform: [
      invert && 'not',
      { name: 'ard1_set', params: { pin } },
    ],
    output: { topic: '/homy/ard1/output' }
  }),
})

// homy/features/${feature_type}/${unique_feature_name}/(status|set|...)
const config = {
  bots: {
    ...ard1Input({
      name: 'corridor2StairsRightBtn',
      pin: 24,
      topic: 'button/corridor2_stairs_right'
    }),
    ...ard1Input({
      name: 'corridor2StairsLeftBtn',
      pin: 25,
      topic: 'button/corridor2_stairs_left'
    }),
    ...ard1Input({
      name: 'antreMainRightBtn',
      pin: 26,
      topic: 'button/antre_main_right'
    }),
    ...ard1Input({
      name: 'antreMainLeftBtn',
      pin: 27,
      topic: 'button/antre_main_left'
    }),
    ...ard1Input({
      name: 'corridor1StairsRightBtn',
      pin: 32,
      topic: 'button/corridor1_stairs_right'
    }),
    ...ard1Input({
      name: 'corridor1StairsLeftBtn',
      pin: 33,
      topic: 'button/corridor1_stairs_left'
    }),
    ...ard1Input({
      name: 'verandaWestRightBtn',
      pin: 40,
      topic: 'button/veranda_west_right'
    }),
    ...ard1Input({
      name: 'verandaWestLeftBtn',
      pin: 41,
      topic: 'button/veranda_west_left'
    }),
    ...ard1Input({
      name: 'bedroomLeftbedRightBtn',
      pin: 42,
      topic: 'button/bedroom_leftbed_right'
    }),
    ...ard1Input({
      name: 'bedroomLeftbedLeftBtn',
      pin: 43,
      topic: 'button/bedroom_leftbed_left'
    }),

    ...ard1Output({
      name: 'antreCeilingLight',
      pin: 15,
      topic: 'light/antre_ceiling_light',
    }),
    ...ard1Output({
      name: 'bedroomBedLeftLight',
      pin: 21,
      topic: 'light/bedroom_bed_left_light',
    }),
    ...ard1Output({
      name: 'verandaWestLight',
      pin: 62,
      topic: 'light/veranda_west_light',
    }),

    ...drySwitch({
      name: 'frontMainDoorOpen',
      device: 'mbsl32di1',
      bit: 0,
      invert: true,
      topic: 'open/front_main_door_open',
    }),
    ...drySwitch({
      name: 'frontSideDoorOpen',
      device: 'mbsl32di1',
      bit: 1,
      invert: true,
      topic: 'open/front_side_door_open',
    }),
    ...drySwitch({
      name: 'livingWindowOpen',
      device: 'mbsl32di1',
      bit: 2,
      invert: true,
      topic: 'open/living_window_open',
    }),
    ...drySwitch({
      name: 'cabinetSouthWindowOpen',
      device: 'mbsl32di1',
      bit: 3,
      invert: true,
      topic: 'open/cabinet_south_window_open',
    }),
    ...drySwitch({
      name: 'cabinetWestWindowOpen',
      device: 'mbsl32di1',
      bit: 4,
      invert: true,
      topic: 'open/cabinet_west_window_open',
    }),
    ...drySwitch({
      name: 'bath1DoorLock',
      device: 'mbsl32di1',
      bit: 5,
      invert: false,
      topic: 'lock/bath1_door_lock',
    }),
    ...drySwitch({
      name: 'bath1DoorOpen',
      device: 'mbsl32di1',
      bit: 6,
      invert: true,
      topic: 'open/bath1_door_open',
    }),
    ...drySwitch({
      name: 'cabinetDoorLock',
      device: 'mbsl32di1',
      bit: 7,
      invert: false,
      topic: 'lock/cabinet_door_lock',
    }),
    ...drySwitch({
      name: 'cabinetDoorOpen',
      device: 'mbsl32di1',
      bit: 8,
      invert: true,
      topic: 'open/cabinet_door_open',
    }),
    ...drySwitch({
      name: 'bath2DoorLock',
      device: 'mbsl32di1',
      bit: 9,
      invert: false,
      topic: 'lock/bath2_door_lock',
    }),
    ...drySwitch({
      name: 'bath2DoorOpen',
      device: 'mbsl32di1',
      bit: 10,
      invert: true,
      topic: 'open/bath2_door_open',
    }),
    ...drySwitch({
      name: 'bath3DoorLock',
      device: 'mbsl32di1',
      bit: 11,
      invert: false,
      topic: 'lock/bath3_door_lock',
    }),
    ...drySwitch({
      name: 'bath3DoorOpen',
      device: 'mbsl32di1',
      bit: 12,
      invert: true,
      topic: 'open/bath3_door_open',
    }),
    ...drySwitch({
      name: 'gerganaDoorLock',
      device: 'mbsl32di1',
      bit: 13,
      invert: false,
      topic: 'lock/gergana_door_lock',
    }),
    ...drySwitch({
      name: 'gerganaDoorOpen',
      device: 'mbsl32di1',
      bit: 14,
      invert: true,
      topic: 'open/gergana_door_open',
    }),
    ...drySwitch({
      name: 'bedroomDoorLock',
      device: 'mbsl32di1',
      bit: 15,
      invert: false,
      topic: 'lock/bedroom_door_lock',
    }),
    ...drySwitch({
      name: 'bedroomDoorOpen',
      device: 'mbsl32di1',
      bit: 16,
      invert: true,
      topic: 'open/bedroom_door_open',
    }),
    ...drySwitch({
      name: 'borisDoorLock',
      device: 'mbsl32di1',
      bit: 17,
      invert: false,
      topic: 'lock/boris_door_lock',
    }),
    ...drySwitch({
      name: 'borisDoorOpen',
      device: 'mbsl32di1',
      bit: 18,
      invert: true,
      topic: 'open/boris_door_open',
    }),
    ...drySwitch({
      name: 'bath1WindowOpen',
      device: 'mbsl32di1',
      bit: 19,
      invert: true,
      topic: 'open/bath1_window_open'
    }),
    ...drySwitch({
      name: 'martinDoorLock',
      device: 'mbsl32di1',
      bit: 20,
      invert: false,
      topic: 'lock/martin_door_lock',
    }),
    ...drySwitch({
      name: 'martinDoorOpen',
      device: 'mbsl32di1',
      bit: 21,
      invert: true,
      topic: 'open/martin_door_open',
    }),
    ...drySwitch({
      name: 'serviceInternalDoorLock',
      device: 'mbsl32di1',
      bit: 22,
      invert: false,
      topic: 'lock/service_internal_door_lock',
    }),
    ...drySwitch({
      name: 'serviceInternalDoorOpen',
      device: 'mbsl32di1',
      bit: 23,
      invert: true,
      topic: 'open/service_internal_door_open',
    }),
    ...drySwitch({
      name: 'kitchenWindowOpen',
      device: 'mbsl32di1',
      bit: 24,
      invert: true,
      topic: 'open/kitchen_window_open'
    }),
    ...drySwitch({
      name: 'bath2WindowOpen',
      device: 'mbsl32di1',
      bit: 25,
      invert: true,
      topic: 'open/bath2_window_open'
    }),
    ...drySwitch({
      name: 'bedroomExternalDoorOpen',
      device: 'mbsl32di1',
      bit: 26,
      invert: true,
      topic: 'open/bedroom_external_door_open'
    }),
    ...drySwitch({
      name: 'bedroomWindowOpen',
      device: 'mbsl32di1',
      bit: 27,
      invert: true,
      topic: 'open/bedroom_window_open'
    }),
    ...drySwitch({
      name: 'martinWestWindowOpen',
      device: 'mbsl32di1',
      bit: 28,
      invert: true,
      topic: 'open/martin_west_window_open'
    }),
    ...drySwitch({
      name: 'martinSouthWindowOpen',
      device: 'mbsl32di1',
      bit: 29,
      invert: true,
      topic: 'open/martin_south_window_open'
    }),
    ...drySwitch({
      name: 'gerganaExternalDoorOpen',
      device: 'mbsl32di1',
      bit: 30,
      invert: true,
      topic: 'open/gergana_external_door_open'
    }),
    ...drySwitch({
      name: 'borisExternalDoorOpen',
      device: 'mbsl32di1',
      bit: 31,
      invert: true,
      topic: 'open/boris_external_door_open'
    }),
    ...drySwitch({
      name: 'gerganaWindowOpen',
      device: 'mbsl32di2',
      bit: 0,
      invert: true,
      topic: 'open/gergana_window_open'
    }),
    ...drySwitch({
      name: 'borisWindowOpen',
      device: 'mbsl32di2',
      bit: 1,
      invert: true,
      topic: 'open/boris_window_open'
    }),
    ...drySwitch({
      name: 'bath3SwitchLeft',
      device: 'mbsl32di2',
      bit: 3,
      topic: 'switch/bath3_switch_left'
    }),
    ...drySwitch({
      name: 'bath3SwitchRight',
      device: 'mbsl32di2',
      bit: 2,
      topic: 'switch/bath3_switch_right'
    }),
    ...drySwitch({
      name: 'bath2SwitchRight',
      device: 'mbsl32di2',
      bit: 4,
      topic: 'switch/bath2_switch_right'
    }),
    ...drySwitch({
      name: 'bath2SwitchLeft',
      device: 'mbsl32di2',
      bit: 5,
      topic: 'switch/bath2_switch_left'
    }),
    ...drySwitch({
      name: 'bedroomSwitchRight',
      device: 'mbsl32di2',
      bit: 6,
      topic: 'switch/bedroom_switch_right'
    }),
    ...drySwitch({
      name: 'bedroomSwitchLeft',
      device: 'mbsl32di2',
      bit: 7,
      topic: 'switch/bedroom_switch_left'
    }),
    ...drySwitch({
      name: 'martinButtonRight',
      device: 'mbsl32di2',
      bit: 8,
      topic: 'button/martin_button_right'
    }),
    ...drySwitch({
      name: 'martinSwitchLeft',
      device: 'mbsl32di2',
      bit: 9,
      topic: 'switch/martin_switch_left'
    }),
    ...drySwitch({
      name: 'borisSwitchLeft',
      device: 'mbsl32di2',
      bit: 10,
      topic: 'switch/boris_switch_left'
    }),
    ...drySwitch({
      name: 'borisSwitchRight',
      device: 'mbsl32di2',
      bit: 11,
      topic: 'switch/boris_switch_right'
    }),
    ...drySwitch({
      name: 'gerganaSwitchLeft',
      device: 'mbsl32di2',
      bit: 12,
      topic: 'switch/gergana_switch_left'
    }),
    ...drySwitch({
      name: 'gerganaSwitchRight',
      device: 'mbsl32di2',
      bit: 13,
      topic: 'switch/gergana_switch_right'
    }),
    ...drySwitch({
      name: 'bath1MainLeftBtn',
      device: 'mbsl32di2',
      bit: 18,
      topic: 'button/bath1_switch_left'
    }),
    ...drySwitch({
      name: 'bath1MainRightBtn',
      device: 'mbsl32di2',
      bit: 19,
      topic: 'button/bath1_switch_right'
    }),
    ...drySwitch({
      name: 'laundryWindowOpen',
      device: 'mbsl32di2',
      bit: 20,
      invert: true,
      topic: 'open/laundry_window_open'
    }),
    ...drySwitch({
      name: 'bath3WindowOpen',
      device: 'mbsl32di2',
      bit: 21,
      invert: true,
      topic: 'open/bath3_window_open'
    }),
    ...drySwitch({
      name: 'officeMainRightBtn',
      device: 'mbsl32di2',
      bit: 22,
      topic: 'button/office_main_right'
    }),
    ...drySwitch({
      name: 'officeMainLeftBtn',
      device: 'mbsl32di2',
      bit: 23,
      topic: 'button/office_main_left'
    }),
    ...drySwitch({
      name: 'livingMainRightBtn',
      device: 'mbsl32di2',
      bit: 24,
      topic: 'button/living_main_right'
    }),
    ...drySwitch({
      name: 'livingMainLeftBtn',
      device: 'mbsl32di2',
      bit: 25,
      topic: 'button/living_main_left'
    }),
    ...drySwitch({
      name: 'corridor1KitchenLeftBtn',
      device: 'mbsl32di2',
      bit: 26,
      topic: 'button/corridor1_kitchen_left'
    }),
    ...drySwitch({
      name: 'corridor1KitchenRightBtn',
      device: 'mbsl32di2',
      bit: 27,
      topic: 'button/corridor1_kitchen_right'
    }),
    ...drySwitch({
      name: 'livingMainUpBtn',
      device: 'mbsl32di2',
      bit: 28,
      topic: 'button/living_main_up'
    }),
    ...drySwitch({
      name: 'livingMainDownBtn',
      device: 'mbsl32di2',
      bit: 29,
      topic: 'button/living_main_down'
    }),
    ...drySwitch({
      name: 'corridor2LaundryRightBtn',
      device: 'mbsl32di2',
      bit: 30,
      topic: 'button/corridor2_laundry_right'
    }),
    ...drySwitch({
      name: 'corridor2LaundryLeftBtn',
      device: 'mbsl32di2',
      bit: 31,
      topic: 'button/corridor2_laundry_left'
    }),

    ...relay({
      name: 'kitchenAllCeilingLights',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 8,
      topic: 'light/kitchen_all_ceiling_lights'
    }),
    ...relay({
      name: 'corridor1CeilingLight',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 9,
      topic: 'light/corridor1_ceiling_light'
    }),
    ...relay({
      name: 'corridor2BothCeilingLights',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 10,
      topic: 'light/corridor2_both_ceiling_lights'
    }),
    ...relay({
      name: 'laundryCeilingLight',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 11,
      topic: 'light/laundry_ceiling_light'
    }),
    ...relay({
      name: 'bath3CeilingLight',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 13,
      topic: 'light/bath3_ceiling_light'
    }),
    ...relay({
      name: 'serviceBoilerContactor',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 14,
      topic: 'relay/service_boiler_contactor'
    }),
    ...relay({
      name: 'externalHouseLights',
      device: 'relays00-15',
      bus: 'dry-switches',
      bit: 15,
      topic: 'light/external_house_lights'
    }),
    ...relay({
      name: 'bedroomCeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 8,
      topic: 'light/bedroom_ceiling_light',
    }),
    ...relay({
      name: 'martinCeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 9,
      topic: 'light/martin_ceiling_light',
    }),
    ...relay({
      name: 'gerganaCeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 10,
      topic: 'light/gergana_ceiling_light',
    }),
    ...relay({
      name: 'borisCeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 11,
      topic: 'light/boris_ceiling_light',
    }),
    ...relay({
      name: 'bath2CeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 12,
      topic: 'light/bath2_ceiling_light',
    }),
    ...relay({
      name: 'bath1CeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 13,
      topic: 'light/bath1_ceiling_light',
    }),
    ...relay({
      name: 'officeCeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 14,
      topic: 'light/office_ceiling_light',
    }),
    ...relay({
      name: 'livingroomCeilingLight',
      device: 'relays16-31',
      bus: 'dry-switches',
      bit: 15,
      topic: 'light/livingroom_ceiling_light',
    }),
    ...relay({
      name: 'irrigationFlowerGround',
      device: 'relays32-47',
      bus: 'monitoring',
      bit: 4,
      topic: 'relay/irrigation_flower_ground'
    }),
    ...relay({
      name: 'irrigationFlowerPots',
      device: 'relays32-47',
      bus: 'monitoring',
      bit: 5,
      topic: 'relay/irrigation_flower_pots'
    }),
    ...relay({
      name: 'irrigationGrassPergola',
      device: 'relays32-47',
      bus: 'monitoring',
      bit: 6,
      topic: 'relay/irrigation_grass_pergola'
    }),
    ...relay({
      name: 'irrigationGrassNorthWest',
      device: 'relays32-47',
      bus: 'monitoring',
      bit: 7,
      topic: 'relay/irrigation_grass_north_west'
    }),

    ...state({
      name: 'temperatureBoilerLow',
      input: {topic: '/modbus/monitoring/solar_heater/reading'},
      transform: [
        { name: 'get_object_key', params: { key: 't1' } },
      ],
      output: {topic: 'sensor/temperature_boiler_low'},
    }),
    ...state({
      name: 'temperatureBoilerHigh',
      input: {topic: '/modbus/monitoring/solar_heater/reading'},
      transform: [
        { name: 'get_object_key', params: { key: 't2' } },
      ],
      output: {topic: 'sensor/temperature_boiler_high'},
    }),
    ...state({
      name: 'temperatureSolarPanel',
      input: {topic: '/modbus/monitoring/solar_heater/reading'},
      transform: [
        { name: 'get_object_key', params: { key: 't3' } },
      ],
      output: {topic: 'sensor/temperature_solar_panel'},
    }),
    ...state({
      name: 'temperatureRoomService',
      input: {topic: '/modbus/monitoring/solar_heater/reading'},
      transform: [
        { name: 'get_object_key', params: { key: 't6' } },
      ],
      output: {topic: 'sensor/temperature_room_service'},
    }),
    ...state({
      name: 'relaySolarHeaterCirculation',
      input: {topic: '/modbus/monitoring/solar_heater/reading'},
      transform: [
        { name: 'get_object_key', params: { key: 'outputs' } },
        { name: 'get_object_key', params: { key: 'p1' } },
      ],
      output: {topic: 'relay/solar_heater_circulation'},
    }),
    ...state({
      name: 'relaySolarHeaterElectricHeater',
      input: {topic: '/modbus/monitoring/solar_heater/reading'},
      transform: [
        { name: 'get_object_key', params: { key: 'outputs' } },
        { name: 'get_object_key', params: { key: 'p6' } },
      ],
      output: {topic: 'relay/solar_heater_electric_heater'},
    }),
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}

console.log(config)

module.exports = config
