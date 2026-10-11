const {parseInstances} = require('./instances')

describe('parseInstances', () => {
    test('without INSTANCES builds one bridge from the single-bridge variables', () => {
        expect(parseInstances({
            TOPIC: 'z2m/house1/+, z2m/house1/+/availability',
            CONVERTER: 'zigbee',
            MQTT_CLIENT_ID: 'mqtt-influx-zigbee',
            TAGS: '{"mesh":"house1"}',
        })).toEqual([{
            clientId: 'mqtt-influx-zigbee',
            topics: ['z2m/house1/+', 'z2m/house1/+/availability'],
            converter: 'zigbee',
            tags: {mesh: 'house1'},
        }])
    })

    test('without INSTANCES or TAGS the bridge has no tags', () => {
        expect(parseInstances({TOPIC: 'ioniq/parsed/#', MQTT_CLIENT_ID: 'x'})[0].tags).toEqual({})
    })

    test('INSTANCES builds one bridge per entry', () => {
        const env = {
            TOPIC: 'ignored',
            INSTANCES: JSON.stringify([
                {clientId: 'mqtt-influx-primary', topic: '/modbus/main/+/+', tags: {bus: 'primary'}},
                {clientId: 'mqtt-influx-zigbee', topic: ['z2m/house1/+', 'z2m/house1/+/availability'], converter: 'zigbee'},
            ]),
        }
        expect(parseInstances(env)).toEqual([
            {clientId: 'mqtt-influx-primary', topics: ['/modbus/main/+/+'], converter: undefined, tags: {bus: 'primary'}},
            {clientId: 'mqtt-influx-zigbee', topics: ['z2m/house1/+', 'z2m/house1/+/availability'], converter: 'zigbee', tags: {}},
        ])
    })

    test.each([
        ['an empty array', []],
        ['an object', {clientId: 'a', topic: 'x'}],
    ])('INSTANCES as %s is rejected', (_, value) => {
        expect(() => parseInstances({INSTANCES: JSON.stringify(value)})).toThrow(/non-empty JSON array/)
    })

    test('an entry without clientId is rejected', () => {
        expect(() => parseInstances({INSTANCES: '[{"topic":"x"}]'})).toThrow(/INSTANCES\[0\] needs a clientId/)
    })

    test('an entry without topic is rejected', () => {
        expect(() => parseInstances({INSTANCES: '[{"clientId":"a","topic":" , "}]'})).toThrow(/\(a\) needs a topic/)
    })

    test('a repeated clientId is rejected', () => {
        expect(() => parseInstances({INSTANCES: '[{"clientId":"a","topic":"x"},{"clientId":"a","topic":"y"}]'}))
            .toThrow(/repeats clientId a/)
    })
})
