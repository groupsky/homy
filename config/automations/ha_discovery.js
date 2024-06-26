const featuresPrefix = process.env.FEATURES_TOPIC_PREFIX || 'homy/features'
const haPrefix = process.env.HA_TOPIC_PREFIX || 'homeassistant'

const areas = {
  antre: 'Антре',
  bath1: 'Баня 1',
  bath2: 'Баня 2',
  bath3: 'Баня 3',
  bedroom: 'Спалня',
  boris: 'Борис',
  cabinet: 'Кабинет',
  corridor1: 'Коридор 1',
  corridor2: 'Коридор 2',
  external: 'Вън',
  gergana: 'Гергана',
  irrigation: 'Поливане',
  kitchen: 'Кухня',
  laundry: 'Мокро',
  livingroom: 'Хол',
  martin: 'Мартин',
  roof: 'Покрив',
  service: 'Сервизно',
}

const devices = {
  ...Object.fromEntries(Object.entries(areas).map(([key, name]) => [key, {
    identifiers: `device_area_${key}`,
    name,
    suggested_area: areas[key]
  }])),

  boiler: {
    identifiers: 'boiler_eldom_200l',
    manufacturer: 'eldom',
    model: '200l',
    name: 'boiler',
    suggested_area: areas.service
  },

  solarPanel: {
    identifiers: 'solar_panel',
    name: 'solar_panel',
    suggested_area: areas.roof
  },
}

const haLight = (
  {
    name,
    feature,
    config
  }
) => ({
  [`${name}HaDiscovery`]: {
    type: 'transform',
    input: {
      name: 'inputs/static', params: {
        payload: {
          schema: 'template',
          command_topic: `${featuresPrefix}/light/${feature}/set`,
          command_on_template: JSON.stringify({ state: true, _src: 'ha' }),
          command_off_template: JSON.stringify({ state: false, _src: 'ha' }),
          state_topic: `${featuresPrefix}/light/${feature}/status`,
          state_template: `{{- 'on' if value_json.state else 'off' -}}`,
          unique_id: `homy_light_${feature}`,
          ...config
        }
      }
    },
    transform: [],
    output: { name: 'outputs/mqtt', params: { topic: `${haPrefix}/light/${feature}/config`, retain: true } }
  }
})

const haSwitch = (
  {
    name,
    feature_type,
    feature,
    config
  }
) => ({
  [`${name}HaDiscovery`]: {
    type: 'transform',
    input: {
      name: 'inputs/static', params: {
        payload: {
          command_topic: `${featuresPrefix}/${feature_type}/${feature}/set`,
          payload_on: JSON.stringify({ state: true, _src: 'ha' }),
          payload_off: JSON.stringify({ state: false, _src: 'ha' }),
          state_topic: `${featuresPrefix}/${feature_type}/${feature}/status`,
          state_on: 'on',
          state_off: 'off',
          value_template: `{{- 'on' if value_json.state else 'off' -}}`,
          unique_id: `homy_${feature_type}_${feature}`,
          ...config
        }
      }
    },
    transform: [],
    output: { name: 'outputs/mqtt', params: { topic: `${haPrefix}/switch/${feature}/config`, retain: true } }
  }
})

/**
 * @param {string} name
 * @param {string} feature
 * @param {('door'|'lock'|'window')} device_class
 * @param {object} config
 * @param {string} feature_type
 * @return {Object}
 */
const haBinarySensor = (
  {
    name,
    feature,
    type: device_class,
    config,
    feature_type = device_class === 'lock' ? 'lock' : 'open'
  }
) => ({
  [`${name}HaDiscovery`]: {
    type: 'transform',
    input: {
      name: 'inputs/static', params: {
        payload: {
          name,
          device_class,
          state_topic: `${featuresPrefix}/${feature_type}/${feature}/status`,
          value_template: device_class === 'lock' ? '{{ \'OFF\' if value_json.state else \'ON\' }}' : '{{ \'ON\' if value_json.state else \'OFF\' }}',
          unique_id: `homy_${device_class}_${feature}`,
          ...config
        }
      }
    },
    transform: [],
    output: { name: 'outputs/mqtt', params: { topic: `${haPrefix}/binary_sensor/${feature}/config`, retain: true } }
  }
})

/**
 * @param {string} name
 * @param {string} feature
 * @param {null|'apparent_power'|'current'|'energy'|'frequency'|'humidity'|'power_factor'|'power'|'pressure'|'reactive_power'|'temperature'|'timestamp'|'voltage'} device_class
 * @param {object} config
 * @param {string} feature_type
 * @return {Object}
 */
const haSensor = (
  {
    name,
    feature,
    type: device_class,
    config,
    feature_type = 'sensor'
  }
) => ({
  [`${name}HaDiscovery`]: {
    type: 'transform',
    input: {
      name: 'inputs/static', params: {
        payload: {
          name,
          device_class,
          state_topic: `${featuresPrefix}/${feature_type}/${feature}/status`,
          value_template: '{{ value_json.state }}',
          unique_id: `homy_${device_class}_${feature}`,
          ...config
        }
      }
    },
    transform: [],
    output: { name: 'outputs/mqtt', params: { topic: `${haPrefix}/sensor/${feature}/config`, retain: true } }
  }
})

const config = {
  bots: {
    ...haLight({
      name: 'antreCeilingLight',
      feature: 'antre_ceiling_light',
      config: {
        name: 'Антре',
        device: devices.antre,
        object_id: 'antre_ceiling_light',
        unique_id: 'homy_antre_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bath2CeilingLight',
      feature: 'bath2_ceiling_light',
      config: {
        name: 'Баня 2',
        device: devices.bath2,
        object_id: 'bath2_ceiling_light',
        unique_id: 'homy_bath2_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bath3CeilingLight',
      feature: 'bath3_ceiling_light',
      config: {
        name: 'Баня 3',
        device: devices.bath3,
        object_id: 'bath3_ceiling_light',
        unique_id: 'homy_bath3_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bedroomCeilingLight',
      feature: 'bedroom_ceiling_light',
      config: {
        name: 'Спалня',
        device: devices.bedroom,
        object_id: 'bedroom_ceiling_light',
        unique_id: 'homy_bedroom_ceiling_light',
      }
    }),
    ...haLight({
      name: 'martinCeilingLight',
      feature: 'martin_ceiling_light',
      config: {
        name: 'Мартин',
        device: devices.martin,
        object_id: 'martin_ceiling_light',
        unique_id: 'homy_martin_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bath1CeilingLight',
      feature: 'bath1_ceiling_light',
      config: {
        name: 'Баня 1',
        device: devices.bath1,
        object_id: 'bath1_ceiling_light',
        unique_id: 'homy_bath1_ceiling_light',
      }
    }),
    ...haLight({
      name: 'officeCeilingLight',
      feature: 'office_ceiling_light',
      config: {
        name: 'Кабинет',
        device: devices.cabinet,
        object_id: 'office_ceiling_light',
        unique_id: 'homy_office_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bedroomBedLeftLight',
      feature: 'bedroom_bed_left_light',
      config: {
        name: 'Спалня лява',
        device: devices.bedroom,
        object_id: 'bedroom_bed_left_light',
        unique_id: 'homy_bedroom_bed_left_light',
      }
    }),
    ...haLight({
      name: 'verandaWestLight',
      feature: 'veranda_west_light',
      config: {
        name: 'Веранда запад',
        device: devices.external,
        object_id: 'veranda_west_light',
        unique_id: 'homy_veranda_west_light',
      }
    }),
    ...haLight({
      name: 'gerganaCeilingLight',
      feature: 'gergana_ceiling_light',
      config: {
        name: 'Гергана',
        device: devices.gergana,
        object_id: 'gergana_ceiling_light',
        unique_id: 'homy_gegana_ceiling_light',
      }
    }),
    ...haLight({
      name: 'borisCeilingLight',
      feature: 'boris_ceiling_light',
      config: {
        name: 'Борис',
        device: devices.boris,
        object_id: 'boris_ceiling_light',
        unique_id: 'homy_boris_ceiling_light',
      }
    }),
    ...haLight({
      name: 'laundryCeilingLight',
      feature: 'laundry_ceiling_light',
      config: {
        name: 'Мокро',
        device: devices.laundry,
        object_id: 'laundry_ceiling_light',
        unique_id: 'homy_laundry_ceiling_light',
      }
    }),
    ...haLight({
      name: 'corridor2BothCeilingLights',
      feature: 'corridor2_both_ceiling_lights',
      config: {
        name: 'Коридор 2',
        device: devices.corridor2,
        object_id: 'corridor2_both_ceiling_lights',
        unique_id: 'homy_corridor2_both_ceiling_lights',
      }
    }),
    ...haLight({
      name: 'kitchenAllCeilingLights',
      feature: 'kitchen_all_ceiling_lights',
      config: {
        name: 'Кухня',
        device: devices.kitchen,
        object_id: 'kitchen_all_ceiling_lights',
        unique_id: 'homy_kitchen_all_ceiling_lights',
      }
    }),
    ...haLight({
      name: 'corridor1CeilingLight',
      feature: 'corridor1_ceiling_light',
      config: {
        name: 'Коридор 1',
        device: devices.corridor1,
        object_id: 'corridor1_ceiling_light',
        unique_id: 'homy_corridor1_ceiling_light',
      }
    }),
    ...haLight({
      name: 'livingroomCeilingLight',
      feature: 'livingroom_ceiling_light',
      config: {
        name: 'Хол',
        device: devices.livingroom,
        object_id: 'livingroom_ceiling_light',
        unique_id: 'homy_livingroom_ceiling_light',
      }
    }),
    ...haLight({
      name: 'externalHouseLights',
      feature: 'external_house_lights',
      config: {
        name: 'Къща',
        device: devices.external,
        object_id: 'external_house_lights',
        unique_id: 'homy_external_house_lights',
      }
    }),

    ...haBinarySensor({
      name: 'frontMainDoorOpen',
      feature_type: 'open',
      feature: 'front_main_door_open',
      type: 'door',
      config: {
        name: 'Входна',
        device: devices.antre,
        object_id: 'front_main_door_open',
        unique_id: 'homy_front_main_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'frontSideDoorOpen',
      feature_type: 'open',
      feature: 'front_side_door_open',
      type: 'door',
      config: {
        name: 'Помощна',
        device: devices.antre,
        object_id: 'front_side_door_open',
        unique_id: 'homy_front_side_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'laundryWindowOpen',
      feature_type: 'open',
      feature: 'laundry_window_open',
      type: 'window',
      config: {
        name: 'Мокро',
        device: devices.laundry,
        object_id: 'laundry_window_open',
        unique_id: 'homy_laundry_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'livingWindowOpen',
      feature_type: 'open',
      feature: 'living_window_open',
      type: 'window',
      config: {
        name: 'Хол запад',
        device: devices.livingroom,
        object_id: 'living_window_open',
        unique_id: 'homy_living_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'cabinetSouthWindowOpen',
      feature_type: 'open',
      feature: 'cabinet_south_window_open',
      type: 'window',
      config: {
        name: 'Кабинет запад',
        device: devices.cabinet,
        object_id: 'cabinet_south_window_open',
        unique_id: 'homy_cabinet_south_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'cabinetWestWindowOpen',
      feature_type: 'open',
      feature: 'cabinet_west_window_open',
      type: 'window',
      config: {
        name: 'Кабинет юг',
        device: devices.cabinet,
        object_id: 'cabinet_west_window_open',
        unique_id: 'homy_cabinet_west_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'bath1DoorLock',
      feature_type: 'lock',
      feature: 'bath1_door_lock',
      type: 'lock',
      config: {
        name: 'Баня 1',
        device: devices.bath1,
        object_id: 'bath1_door_lock',
        unique_id: 'homy_bath1_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'bath1DoorOpen',
      feature_type: 'open',
      feature: 'bath1_door_open',
      type: 'door',
      config: {
        name: 'Баня 1',
        device: devices.bath1,
        object_id: 'bath1_door_open',
        unique_id: 'homy_bath1_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'cabinetDoorLock',
      feature_type: 'lock',
      feature: 'cabinet_door_lock',
      type: 'lock',
      config: {
        name: 'Кабинет',
        device: devices.cabinet,
        object_id: 'cabinet_door_lock',
        unique_id: 'homy_cabinet_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'cabinetDoorOpen',
      feature_type: 'open',
      feature: 'cabinet_door_open',
      type: 'door',
      config: {
        name: 'Кабинет',
        device: devices.cabinet,
        object_id: 'cabinet_door_open',
        unique_id: 'homy_cabinet_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'bath2DoorLock',
      feature_type: 'lock',
      feature: 'bath2_door_lock',
      type: 'lock',
      config: {
        name: 'Баня 2',
        device: devices.bath2,
        object_id: 'bath2_door_lock',
        unique_id: 'homy_bath2_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'bath2DoorOpen',
      feature_type: 'open',
      feature: 'bath2_door_open',
      type: 'door',
      config: {
        name: 'Баня 2',
        device: devices.bath2,
        object_id: 'bath2_door_open',
        unique_id: 'homy_bath2_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'bath3DoorLock',
      feature_type: 'lock',
      feature: 'bath3_door_lock',
      type: 'lock',
      config: {
        name: 'Баня 3',
        device: devices.bath3,
        object_id: 'bath3_door_lock',
        unique_id: 'homy_bath3_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'bath3DoorOpen',
      feature_type: 'open',
      feature: 'bath3_door_open',
      type: 'door',
      config: {
        name: 'Баня 3',
        device: devices.bath3,
        object_id: 'bath3_door_open',
        unique_id: 'homy_bath3_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'gerganaDoorLock',
      feature_type: 'lock',
      feature: 'gergana_door_lock',
      type: 'lock',
      config: {
        name: 'Гергана',
        device: devices.gergana,
        object_id: 'gergana_door_lock',
        unique_id: 'homy_gergana_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'gerganaDoorOpen',
      feature_type: 'open',
      feature: 'gergana_door_open',
      type: 'door',
      config: {
        name: 'Гергана',
        device: devices.gergana,
        object_id: 'gergana_door_open',
        unique_id: 'homy_gergana_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'bedroomDoorLock',
      feature_type: 'lock',
      feature: 'bedroom_door_lock',
      type: 'lock',
      config: {
        name: 'Спалня',
        device: devices.bedroom,
        object_id: 'bedroom_door_lock',
        unique_id: 'homy_bedroom_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'bedroomDoorOpen',
      feature_type: 'open',
      feature: 'bedroom_door_open',
      type: 'door',
      config: {
        name: 'Спалня',
        device: devices.bedroom,
        object_id: 'bedroom_door_open',
        unique_id: 'homy_bedroom_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'borisDoorLock',
      feature_type: 'lock',
      feature: 'boris_door_lock',
      type: 'lock',
      config: {
        name: 'Борис',
        device: devices.boris,
        object_id: 'boris_door_lock',
        unique_id: 'homy_boris_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'borisDoorOpen',
      feature_type: 'open',
      feature: 'boris_door_open',
      type: 'door',
      config: {
        name: 'Борис',
        device: devices.boris,
        object_id: 'boris_door_open',
        unique_id: 'homy_boris_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'bath1WindowOpen',
      feature_type: 'open',
      feature: 'bath1_window_open',
      type: 'window',
      config: {
        name: 'Баня 1',
        device: devices.bath1,
        object_id: 'bath1_window_open',
        unique_id: 'homy_bath1_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'martinDoorLock',
      feature_type: 'lock',
      feature: 'martin_door_lock',
      type: 'lock',
      config: {
        name: 'Мартин',
        device: devices.martin,
        object_id: 'martin_door_lock',
        unique_id: 'homy_martin_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'martinDoorOpen',
      feature_type: 'open',
      feature: 'martin_door_open',
      type: 'door',
      config: {
        name: 'Мартин',
        device: devices.martin,
        object_id: 'martin_door_open',
        unique_id: 'homy_martin_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'serviceInternalDoorLock',
      feature_type: 'lock',
      feature: 'service_internal_door_lock',
      type: 'lock',
      config: {
        name: 'Вътрешна',
        device: devices.service,
        object_id: 'service_internal_door_lock',
        unique_id: 'homy_service_internal_door_lock',
      },
    }),
    ...haBinarySensor({
      name: 'serviceInternalDoorOpen',
      feature_type: 'open',
      feature: 'service_internal_door_open',
      type: 'door',
      config: {
        name: 'Вътрешна',
        device: devices.service,
        object_id: 'service_internal_door_open',
        unique_id: 'homy_service_internal_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'kitchenWindowOpen',
      feature_type: 'open',
      feature: 'kitchen_window_open',
      type: 'window',
      config: {
        name: 'Кухня',
        device: devices.kitchen,
        object_id: 'kitchen_window_open',
        unique_id: 'homy_kitchen_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'bath2WindowOpen',
      feature_type: 'open',
      feature: 'bath2_window_open',
      type: 'window',
      config: {
        name: 'Баня 2',
        device: devices.bath2,
        object_id: 'bath2_window_open',
        unique_id: 'homy_bath2_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'bath3WindowOpen',
      feature_type: 'open',
      feature: 'bath3_window_open',
      type: 'window',
      config: {
        name: 'Баня 3',
        device: devices.bath3,
        object_id: 'bath3_window_open',
        unique_id: 'homy_bath3_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'bedroomExternalDoorOpen',
      feature_type: 'open',
      feature: 'bedroom_external_door_open',
      type: 'door',
      config: {
        name: 'Спалня тераса',
        device: devices.bedroom,
        object_id: 'bedroom_external_door_open',
        unique_id: 'homy_bedroom_external_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'bedroomWindowOpen',
      feature_type: 'open',
      feature: 'bedroom_window_open',
      type: 'window',
      config: {
        name: 'Спалня',
        device: devices.bedroom,
        object_id: 'bedroom_window_open',
        unique_id: 'homy_bedroom_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'martinWestWindowOpen',
      feature_type: 'open',
      feature: 'martin_west_window_open',
      type: 'window',
      config: {
        name: 'Мартин запад',
        device: devices.martin,
        object_id: 'martin_west_window_open',
        unique_id: 'homy_martin_west_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'martinSouthWindowOpen',
      feature_type: 'open',
      feature: 'martin_south_window_open',
      type: 'window',
      config: {
        name: 'Мартин юг',
        device: devices.martin,
        object_id: 'martin_south_window_open',
        unique_id: 'homy_martin_south_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'gerganaExternalDoorOpen',
      feature_type: 'open',
      feature: 'gergana_external_door_open',
      type: 'door',
      config: {
        name: 'Гергана тераса',
        device: devices.gergana,
        object_id: 'gergana_external_door_open',
        unique_id: 'homy_gergana_external_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'borisExternalDoorOpen',
      feature_type: 'open',
      feature: 'boris_external_door_open',
      type: 'door',
      config: {
        name: 'Борис тераса',
        device: devices.boris,
        object_id: 'boris_external_door_open',
        unique_id: 'homy_boris_external_door_open',
      },
    }),
    ...haBinarySensor({
      name: 'gerganaWindowOpen',
      feature_type: 'open',
      feature: 'gergana_window_open',
      type: 'window',
      config: {
        name: 'Гергана',
        device: devices.gergana,
        object_id: 'gergana_window_open',
        unique_id: 'homy_gergana_window_open',
      },
    }),
    ...haBinarySensor({
      name: 'borisWindowOpen',
      feature_type: 'open',
      feature: 'boris_window_open',
      type: 'window',
      config: {
        name: 'Борис',
        device: devices.boris,
        object_id: 'boris_window_open',
        unique_id: 'homy_boris_window_open',
      },
    }),

    ...haSwitch({
      name: 'serviceBoilerContactor',
      feature_type: 'relay',
      feature: 'service_boiler_contactor',
      config: {
        name: 'Бойлер',
        unique_id: 'service_boiler_contactor',
        device: devices.boiler,
        device_class: 'outlet',
      }
    }),

    ...haSwitch({
      name: 'irrigationGrassNorthWest',
      feature_type: 'relay',
      feature: 'irrigation_grass_north_west',
      config: {
        name: 'Трева северозапад',
        unique_id: 'irrigation_grass_north_west',
        device: devices.irrigation,
        device_class: 'outlet',
      }
    }),
    ...haSwitch({
      name: 'irrigationGrassPergola',
      feature_type: 'relay',
      feature: 'irrigation_grass_pergola',
      config: {
        name: 'Трева пергола',
        unique_id: 'irrigation_grass_pergola',
        device: devices.irrigation,
        device_class: 'outlet',
      }
    }),
    ...haSwitch({
      name: 'irrigationFlowerPots',
      feature_type: 'relay',
      feature: 'irrigation_flower_pots',
      config: {
        name: 'Саксии',
        unique_id: 'irrigation_flower_pots',
        device: devices.irrigation,
        device_class: 'outlet',
      }
    }),
    ...haSwitch({
      name: 'irrigationFlowerGround',
      feature_type: 'relay',
      feature: 'irrigation_flower_ground',
      config: {
        name: 'Растения',
        unique_id: 'irrigation_flower_ground',
        device: devices.irrigation,
        device_class: 'outlet',
      }
    }),
    ...haSwitch({
      name: 'irrigationGrassWestCenter',
      feature_type: 'relay',
      feature: 'irrigation_grass_west_center',
      config: {
        name: 'Трева запад-център',
        object_id: 'irrigation_grass_west_center',
        unique_id: 'irrigation_grass_west_center',
        device: devices.irrigation,
        device_class: 'outlet',
      }
    }),

    ...haSensor({
      name: 'temperatureBoilerLow',
      feature: 'temperature_boiler_low',
      type: 'temperature',
      config: {
        name: 'Температура бойлер долу',
        device: devices.boiler,
        object_id: 'temperature_boiler_low',
        unique_id: 'homy_temperature_boiler_low',
        unit_of_measurement: "°C"
      },
    }),
    ...haSensor({
      name: 'temperatureBoilerHigh',
      feature: 'temperature_boiler_high',
      type: 'temperature',
      config: {
        name: 'Температура бойлер горе',
        device: devices.boiler,
        object_id: 'temperature_boiler_high',
        unique_id: 'homy_temperature_boiler_high',
        unit_of_measurement: "°C"
      },
    }),
    ...haSensor({
      name: 'temperatureSolarPanel',
      feature: 'temperature_solar_panel',
      type: 'temperature',
      config: {
        name: 'Температура соларен панел',
        device: devices.solarPanel,
        object_id: 'temperature_solar_panel',
        unique_id: 'homy_temperature_solar_panel',
        unit_of_measurement: "°C"
      },
    }),
    ...haSensor({
      name: 'temperatureRoomService',
      feature: 'temperature_room_service',
      type: 'temperature',
      config: {
        name: 'Температура сервизно',
        device: devices.service,
        object_id: 'temperature_room_service',
        unique_id: 'homy_temperature_room_service',
        unit_of_measurement: "°C"
      },
    }),

    ...haBinarySensor({
      name: 'relaySolarHeaterCirculation',
      feature_type: 'relay',
      feature: 'solar_heater_circulation',
      type: 'power',
      config: {
        name: 'Циркулация соларен панел',
        device: devices.solarPanel,
        object_id: 'solar_heater_circulation',
        unique_id: 'homy_solar_heater_circulation',
      },
    }),
    ...haBinarySensor({
      name: 'relaySolarHeaterElecticHeater',
      feature_type: 'relay',
      feature: 'solar_heater_electric_heater',
      type: 'power',
      config: {
        name: 'Електрически нагревател',
        device: devices.boiler,
        object_id: 'solar_heater_electric_heater',
        unique_id: 'homy_solar_heater_electric_heater',
      },
    }),
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}

module.exports = config
