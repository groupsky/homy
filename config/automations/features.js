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
    ],
    filterOutput: 'state_not_null',
    output: { name: 'outputs/mqtt', params: { topic: `${prefix}/${outputTopic}/status`, retain: true } }
  },
})

/**
 *
 * @param {string} name
 * @param {'mbsl32di1'|'mbsl32di2'} device
 * @param {number} bit
 * @param {boolean} invert
 * @param {string} topic
 * @return {Object}
 */
const drySwitch = (
  {
    name,
    device,
    bit,
    invert = false,
    topic
  }
) => state({
  name,
  input: { topic: `/modbus/dry-switches/${device}/reading` },
  transform: [
    { name: 'inputs_bit_status', params: { bit } },
    invert && 'not'
  ].filter(Boolean),
  output: { topic }
})

/**
 * @param {string} name
 * @param {number} pin
 * @param {string} topic
 * @return {Object}
 */
const ard1Output = (
  {
    name,
    pin,
    topic
  }
) => ({
  ...state({
    name,
    input: { topic: '/homy/ard1/input' },
    transform: [{ name: 'ard1_output_status', params: { pin } }],
    output: { topic }
  }),
  [`${name}Cmd`]: {
    type: 'transform',
    input: { name: 'inputs/mqtt', params: { topic: `${prefix}/${topic}/set` } },
    filterInput: 'not_null',
    transform: [
      'from_state',
      { name: 'ard1_output_set', params: { pin } },
    ],
    output: { name: 'outputs/mqtt', params: { topic: '/homy/ard1/output', retain: true } }
  },
})

// homy/features/${feature_type}/${unique_feature_name}/(status|set|...)
module.exports = {
  bots: {
    ...ard1Output({
      name: 'antreCeilingLight',
      pin: 15,
      topic: 'light/antre_ceiling_light',
    }),
    ...ard1Output({
      name: 'bath2CeilingLight',
      pin: 16,
      topic: 'light/bath2_ceiling_light',
    }),
    ...ard1Output({
      name: 'bedroomCeilingLight',
      pin: 17,
      topic: 'light/bedroom_ceiling_light',
    }),
    ...ard1Output({
      name: 'martinCeilingLight',
      pin: 18,
      topic: 'light/martin_ceiling_light',
    }),
    ...ard1Output({
      name: 'bath1CeilingLight',
      pin: 19,
      topic: 'light/bath1_ceiling_light',
    }),
    ...ard1Output({
      name: 'officeCeilingLight',
      pin: 20,
      topic: 'light/office_ceiling_light',
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
    ...ard1Output({
      name: 'gerganaCeilingLight',
      pin: 63,
      topic: 'light/gergana_ceiling_light',
    }),
    ...ard1Output({
      name: 'borisCeilingLight',
      pin: 64,
      topic: 'light/boris_ceiling_light',
    }),
    ...ard1Output({
      name: 'laundryCeilingLight',
      pin: 65,
      topic: 'light/laundry_ceiling_light',
    }),
    ...ard1Output({
      name: 'corridor2BothCeilingLights',
      pin: 66,
      topic: 'light/corridor2_both_ceiling_lights',
    }),
    ...ard1Output({
      name: 'kitchenAllCeilingLights',
      pin: 67,
      topic: 'light/kitchen_all_ceiling_lights',
    }),
    ...ard1Output({
      name: 'corridor1CeilingLight',
      pin: 68,
      topic: 'light/corridor1_ceiling_light',
    }),
    ...ard1Output({
      name: 'livingroomCeilingLight',
      pin: 69,
      topic: 'light/livingroom_ceiling_light',
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
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}
