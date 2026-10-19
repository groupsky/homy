const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {createDayFileWriter} = require('./day-file-writer')
const {createAdapter, devicesFromBridgeConfig, toReading} = require('./adapter')

// A real reading of the old reader (modbus-serial, devices/dds024mr.js) on
// the tetriary bus, as one line of its NDJSON day file, 2026-10-15.
const OLD_LINE = '{"av":234.19810485839844,"bv":239.46620178222656,"cv":239.82814025878906,' +
  '"ac":0.021371614187955856,"bc":0.4317200481891632,"cc":0.021883852779865265,' +
  '"sum_ap":67.41484069824219,"a_ap":0,"b_ap":67.41484069824219,"c_ap":0,' +
  '"sum_rp":13.498337745666504,"a_rp":4.703027725219727,"b_rp":4.03092098236084,"c_rp":4.7643890380859375,' +
  '"apf":0,"bpf":0.6520922780036926,"cpf":0,"freq":50.00992202758789,' +
  '"tot_act":45967.12890625,"tot_react":15803.3203125,' +
  '"_tz":1792034284417,"_ms":450,"_addr":1,"_type":"dds024mr","device":"heat_pump"}'

// The same values as the bridge publishes them: @ya-modbus/driver-dds024mr
// decodes the same registers with readFloatBE, and the bridge does not round.
// The keys are in a different order on purpose: the output must not depend on it.
const MESSAGE = {
  deviceId: 'heat_pump',
  timestamp: 1792034284417,
  data: {
    active_energy_total: 45967.12890625,
    reactive_energy_total: 15803.3203125,
    voltage_l1: 234.19810485839844,
    voltage_l2: 239.46620178222656,
    voltage_l3: 239.82814025878906,
    current_l1: 0.021371614187955856,
    current_l2: 0.4317200481891632,
    current_l3: 0.021883852779865265,
    active_power_total: 67.41484069824219,
    active_power_l1: 0,
    active_power_l2: 67.41484069824219,
    active_power_l3: 0,
    reactive_power_total: 13.498337745666504,
    reactive_power_l1: 4.703027725219727,
    reactive_power_l2: 4.03092098236084,
    reactive_power_l3: 4.7643890380859375,
    power_factor_l1: 0,
    power_factor_l2: 0.6520922780036926,
    power_factor_l3: 0,
    frequency: 50.00992202758789,
  },
}

// The old line without `_ms`: ya-modbus does not publish the read time.
const EXPECTED = (() => {
  // eslint-disable-next-line no-unused-vars
  const {_ms, ...rest} = JSON.parse(OLD_LINE)
  return rest
})()

const BRIDGE_CONFIG = {
  mqtt: {url: 'mqtt://broker'},
  topicPrefix: 'ya-modbus',
  devices: [{
    deviceId: 'heat_pump',
    driver: '@ya-modbus/driver-dds024mr',
    connection: {type: 'rtu', port: '/dev/ttyUSB0', baudRate: 9600, parity: 'even', slaveId: 1},
    polling: {interval: 1000, mode: 'continuous'},
  }],
}

const DATA_TOPIC = 'ya-modbus/heat_pump/data'
const PUBLISH_TOPIC = '/modbus/tetriary/{name}/reading'

let root
let published
let inserted
let errors

const dayFile = () => path.join(root, 'tetriary', '2026-10-15.tetriary-adapter.ndjson')

function adapter(overrides = {}) {
  return createAdapter({
    devices: devicesFromBridgeConfig(BRIDGE_CONFIG),
    publishTopic: PUBLISH_TOPIC,
    publish: (topic, payload) => published.push({topic, payload}),
    writer: createDayFileWriter({root, stream: 'tetriary', service: 'tetriary-adapter'}),
    insert: async (doc) => { inserted.push(doc) },
    ...overrides,
  })
}

const send = (handle, message, topic = DATA_TOPIC) =>
  handle(topic, Buffer.from(typeof message === 'string' ? message : JSON.stringify(message)))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ya-modbus-adapter-'))
  published = []
  inserted = []
  errors = []
  jest.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')))
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('a ya-modbus data message', () => {
  it('is published on the old topic as the old reading, without _ms', () => {
    send(adapter(), MESSAGE)

    expect(published).toHaveLength(1)
    expect(published[0].topic).toBe('/modbus/tetriary/heat_pump/reading')
    expect(JSON.parse(published[0].payload)).toStrictEqual(EXPECTED)
    // Same keys in the same order, so the text is the same too.
    expect(published[0].payload).toBe(JSON.stringify(EXPECTED))
  })

  it('is written as the old NDJSON line, without _ms', () => {
    send(adapter(), MESSAGE)

    expect(fs.readFileSync(dayFile(), 'utf8')).toBe(JSON.stringify(EXPECTED) + '\n')
  })

  it('is inserted into MongoDB as the old document, without _ms', () => {
    send(adapter(), MESSAGE)

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toStrictEqual(EXPECTED)
    expect(JSON.stringify(inserted[0])).toBe(JSON.stringify(EXPECTED))
  })

  it('is written to InfluxDB as the old reading, without _ms, when InfluxDB is configured', () => {
    const points = []
    send(adapter({influx: {write: (reading) => points.push(reading)}}), MESSAGE)

    expect(points).toStrictEqual([EXPECTED])
    expect(published).toHaveLength(1)
  })

  it('keeps a null value, as the old reader wrote a NaN', () => {
    send(adapter(), {...MESSAGE, data: {...MESSAGE.data, frequency: null}})

    expect(JSON.parse(published[0].payload).freq).toBeNull()
    expect(inserted[0].freq).toBeNull()
    expect(JSON.parse(fs.readFileSync(dayFile(), 'utf8')).freq).toBeNull()
  })

  it('leaves a missing data point out of all three outputs', () => {
    // eslint-disable-next-line no-unused-vars
    const {frequency, ...data} = MESSAGE.data
    send(adapter(), {...MESSAGE, data})

    expect(JSON.parse(published[0].payload)).not.toHaveProperty('freq')
    expect(inserted[0]).not.toHaveProperty('freq')
    expect(JSON.parse(fs.readFileSync(dayFile(), 'utf8'))).not.toHaveProperty('freq')
  })
})

describe('a message that cannot be used', () => {
  it.each([
    ['not JSON', '{"deviceId":'],
    ['no timestamp', {deviceId: 'heat_pump', data: MESSAGE.data}],
    ['a timestamp that is not a number', {...MESSAGE, timestamp: '2026-10-15'}],
    ['no data', {deviceId: 'heat_pump', timestamp: MESSAGE.timestamp}],
    ['data that is not an object', {...MESSAGE, data: [1, 2]}],
  ])('is logged and skipped: %s', (_, message) => {
    send(adapter(), message)

    expect(published).toHaveLength(0)
    expect(inserted).toHaveLength(0)
    expect(fs.existsSync(dayFile())).toBe(false)
    expect(errors).toHaveLength(1)
  })

  it('is ignored on a topic of no configured device', () => {
    send(adapter(), MESSAGE, 'ya-modbus/other/data')

    expect(published).toHaveLength(0)
    expect(inserted).toHaveLength(0)
  })
})

describe('a failing output', () => {
  it('does not stop the others when the NDJSON write fails, and is logged once', () => {
    const writer = {write: () => { throw new Error('disk full') }}
    const handle = adapter({writer})
    send(handle, MESSAGE)
    send(handle, MESSAGE)

    expect(published).toHaveLength(2)
    expect(inserted).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('disk full')
  })

  it('logs a failed Mongo insert and still publishes and writes', async () => {
    send(adapter({insert: () => Promise.reject(new Error('not primary'))}), MESSAGE)
    await new Promise(setImmediate)

    expect(published).toHaveLength(1)
    expect(fs.existsSync(dayFile())).toBe(true)
    expect(errors.join()).toContain('not primary')
  })

  it('skips Mongo when there is no insert (Mongo not configured)', () => {
    send(adapter({insert: null}), MESSAGE)

    expect(published).toHaveLength(1)
    expect(fs.existsSync(dayFile())).toBe(true)
  })
})

describe('devicesFromBridgeConfig', () => {
  it('takes the topic, address and type from the bridge config', () => {
    const [device] = devicesFromBridgeConfig(BRIDGE_CONFIG)

    expect(device).toMatchObject({name: 'heat_pump', address: 1, type: 'dds024mr', topic: DATA_TOPIC})
  })

  it('uses the bridge default prefix "modbus" when the config has none', () => {
    const [device] = devicesFromBridgeConfig({...BRIDGE_CONFIG, topicPrefix: undefined})

    expect(device.topic).toBe('modbus/heat_pump/data')
  })

  it('refuses a driver it has no mapping for', () => {
    const config = {...BRIDGE_CONFIG, devices: [{...BRIDGE_CONFIG.devices[0], driver: '@ya-modbus/driver-or-we-516'}]}

    expect(() => devicesFromBridgeConfig(config)).toThrow(/or-we-516/)
  })

  it('refuses a config without devices', () => {
    expect(() => devicesFromBridgeConfig({topicPrefix: 'ya-modbus'})).toThrow(/devices/)
  })
})

describe('toReading', () => {
  it('maps every data point of the dds024mr table to the old field', () => {
    const [device] = devicesFromBridgeConfig(BRIDGE_CONFIG)

    expect(toReading(MESSAGE, device)).toStrictEqual(EXPECTED)
  })
})
