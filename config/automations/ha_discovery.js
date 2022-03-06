const featuresPrefix = process.env.FEATURES_TOPIC_PREFIX || 'homy/features'
const haPrefix = process.env.HA_TOPIC_PREFIX || 'homeassistant'

const areas = {
  antre: 'Антре',
  bath1: 'Баня 1',
  bath2: 'Баня 2',
  bath3: 'Баня 3',
  bedroom: 'Спалня',
  boris: 'Борис',
  corridor1: 'Коридор 1',
  corridor2: 'Коридор 2',
  external: 'Вън',
  gergana: 'Гергана',
  laundry: 'Мокро',
  livingroom: 'Хол',
  martin: 'Мартин',
  service: 'Севризно',
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
          ...config
        }
      }
    },
    transform: [],
    output: { name: 'outputs/mqtt', params: { topic: `${haPrefix}/light/${feature}/config`, retain: true } }
  }
})

module.exports = {
  bots: {
    ...haLight({
      name: 'antreCeilingLight',
      feature: 'antre_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.antre,
        object_id: 'antre_ceiling_light',
        unique_id: 'homy_antre_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bath2CeilingLight',
      feature: 'bath2_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.bath2,
        object_id: 'bath2_ceiling_light',
        unique_id: 'homy_bath2_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bedroomCeilingLight',
      feature: 'bedroom_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.bedroom,
        object_id: 'bedroom_ceiling_light',
        unique_id: 'homy_bedroom_ceiling_light',
      }
    }),
    ...haLight({
      name: 'martinCeilingLight',
      feature: 'martin_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.martin,
        object_id: 'martin_ceiling_light',
        unique_id: 'homy_martin_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bath1CeilingLight',
      feature: 'bath1_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.bath1,
        object_id: 'bath1_ceiling_light',
        unique_id: 'homy_bath1_ceiling_light',
      }
    }),
    ...haLight({
      name: 'officeCeilingLight',
      feature: 'office_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.bedroom,
        object_id: 'bedroom_ceiling_light',
        unique_id: 'homy_bedroom_ceiling_light',
      }
    }),
    ...haLight({
      name: 'bedroomBedLeftLight',
      feature: 'bedroom_bed_left_light',
      config: {
        name: 'Лява',
        device: devices.bedroom,
        object_id: 'bedroom_bed_left_light',
        unique_id: 'homy_bedroom_bed_left_light',
      }
    }),
    ...haLight({
      name: 'verandaWestLight',
      feature: 'veranda_west_light',
      config: {
        name: 'Запад',
        device: devices.external,
        object_id: 'veranda_west_light',
        unique_id: 'homy_veranda_west_light',
      }
    }),
    ...haLight({
      name: 'gerganaCeilingLight',
      feature: 'gergana_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.gergana,
        object_id: 'gergana_ceiling_light',
        unique_id: 'homy_gegana_ceiling_light',
      }
    }),
    ...haLight({
      name: 'borisCeilingLight',
      feature: 'boris_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.boris,
        object_id: 'boris_ceiling_light',
        unique_id: 'homy_boris_ceiling_light',
      }
    }),
    ...haLight({
      name: 'laundryCeilingLight',
      feature: 'laundry_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.laundry,
        object_id: 'laundry_ceiling_light',
        unique_id: 'homy_laundry_ceiling_light',
      }
    }),
    ...haLight({
      name: 'corridor2BothCeilingLights',
      feature: 'corridor2_both_ceiling_lights',
      config: {
        name: 'Таван',
        device: devices.corridor2,
        object_id: 'corridor2_both_ceiling_lights',
        unique_id: 'homy_corridor2_both_ceiling_lights',
      }
    }),
    ...haLight({
      name: 'kitchenAllCeilingLights',
      feature: 'kitchen_all_ceiling_lights',
      config: {
        name: 'Таван',
        device: devices.laundry,
        object_id: 'kitchen_all_ceiling_lights',
        unique_id: 'homy_kitchen_all_ceiling_lights',
      }
    }),
    ...haLight({
      name: 'corridor1CeilingLight',
      feature: 'corridor1_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.corridor1,
        object_id: 'corridor1_ceiling_light',
        unique_id: 'homy_corridor1_ceiling_light',
      }
    }),
    ...haLight({
      name: 'livingroomCeilingLight',
      feature: 'livingroom_ceiling_light',
      config: {
        name: 'Таван',
        device: devices.livingroom,
        object_id: 'livingroom_ceiling_light',
        unique_id: 'homy_livingroom_ceiling_light',
      }
    }),
  },
  gates: {
    mqtt: {
      url: process.env.BROKER,
      clientId: process.env.MQTT_CLIENT_ID,
    },
  }
}
