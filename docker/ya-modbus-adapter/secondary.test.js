const {afterEach, beforeEach, describe, expect, it} = require('@jest/globals')
const http = require('http')
const {devicesFromBridgeConfig, toReading} = require('./adapter')
const {createInfluxWriter} = require('./influxdb')

// The three meter types of the secondary bus. For each: a real reading of the
// old reader (modbus-serial, devices/<type>.js) as one line of its NDJSON day
// file of 2026-10-18; the same values as the bridge publishes them (the
// drivers decode the same registers and the bridge does not round); and the
// `raw` point the old influxdb integration wrote for that line.
const CASES = [
  {
    type: 'ex9em',
    oldLine: '{"v":230.4,"c":0.2,"p":11,"rp":55,"freq":50,"ap":58,"pow":0.238,"tot_act":8068.69,"tot_react":4822.92,' +
      '"_tz":1792320622727,"_ms":338,"_addr":1,"_type":"ex9em","device":"water_pump"}',
    message: {
      deviceId: 'water_pump',
      timestamp: 1792320622727,
      data: {
        voltage: 230.4,
        current: 0.2,
        frequency: 50,
        active_power: 11,
        reactive_power: 55,
        apparent_power: 58,
        power_factor: 0.238,
        total_active_energy: 8068.69,
        total_reactive_energy: 4822.92,
      },
    },
    slaveId: 1,
    point: 'raw,bus=secondary,device.addr=1,device.name=water_pump,device.type=ex9em ' +
      'ap=58,c=0.2,freq=50,p=11,pow=0.238,rp=55,tot_act=8068.69,tot_react=4822.92,v=230.4 1792320622727',
  },
  {
    type: 'or-we-514',
    oldLine: '{"freq":50.01,"v":231.39,"c":0.151,"p":0,"rp":35,"ap":35,"pow":0.027,"tot_act":342.59,"tot_react":1174.68,' +
      '"_tz":1792320617853,"_ms":515,"_addr":2,"_type":"or-we-514","device":"microwave"}',
    message: {
      deviceId: 'microwave',
      timestamp: 1792320617853,
      data: {
        frequency: 50.01,
        voltage: 231.39,
        current: 0.151,
        active_power: 0,
        reactive_power: 35,
        apparent_power: 35,
        power_factor: 0.027,
        total_active_energy: 342.59,
        total_reactive_energy: 1174.68,
      },
    },
    slaveId: 2,
    point: 'raw,bus=secondary,device.addr=2,device.name=microwave,device.type=or-we-514 ' +
      'ap=35,c=0.151,freq=50.01,p=0,pow=0.027,rp=35,tot_act=342.59,tot_react=1174.68,v=231.39 1792320617853',
  },
  {
    type: 'dds519mr',
    oldLine: '{"v":234.10000610351562,"c":13.531999588012695,"p":3168.89990234375,"pf":1,"freq":50,"tot":11795.509765625,' +
      '"_tz":1792281698680,"_ms":742,"_addr":20,"_type":"dds519mr","device":"boiler"}',
    message: {
      deviceId: 'boiler',
      timestamp: 1792281698680,
      data: {
        voltage: 234.10000610351562,
        current: 13.531999588012695,
        active_power: 3168.89990234375,
        power_factor: 1,
        frequency: 50,
        total_active_energy: 11795.509765625,
      },
    },
    slaveId: 20,
    point: 'raw,bus=secondary,device.addr=20,device.name=boiler,device.type=dds519mr ' +
      'c=13.531999588012695,freq=50,p=3168.89990234375,pf=1,tot=11795.509765625,v=234.10000610351562 1792281698680',
  },
]

const deviceOf = ({type, message, slaveId}) => devicesFromBridgeConfig({
  topicPrefix: 'ya-modbus',
  devices: [{
    deviceId: message.deviceId,
    driver: `@ya-modbus/driver-${type}`,
    connection: {type: 'rtu', port: '/dev/ttyUSB0', baudRate: 9600, parity: 'even', slaveId},
  }],
})[0]

describe.each(CASES)('the $type mapping', (c) => {
  // The old line without `_ms`: ya-modbus does not publish the read time.
  // eslint-disable-next-line no-unused-vars
  const {_ms, ...expected} = JSON.parse(c.oldLine)

  it('gives the old reading, without _ms', () => {
    const reading = toReading(c.message, deviceOf(c))

    expect(reading).toStrictEqual(expected)
    // Same keys in the same order, so the text is the same too.
    expect(JSON.stringify(reading)).toBe(JSON.stringify(expected))
  })

  it('maps every data point of the message to one old field', () => {
    const ids = Object.values(deviceOf(c).mapping)

    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toStrictEqual(Object.keys(c.message.data).sort())
  })
})

// An InfluxDB stand-in that records each write request.
describe('the InfluxDB writer', () => {
  let server
  let requests

  beforeEach(async () => {
    requests = []
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        requests.push({method: req.method, url: req.url, authorization: req.headers.authorization, body})
        res.writeHead(204)
        res.end()
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  // The settings of secondary-power in docker-compose.yml.
  const writer = () => createInfluxWriter({
    url: `http://127.0.0.1:${server.address().port}`,
    username: 'writer',
    password: 'secret',
    database: 'homy',
    tags: {bus: 'secondary'},
    measurement: 'raw',
  })

  it('writes the same raw point as the old integration for a reading of each type', async () => {
    const influx = writer()
    for (const c of CASES) influx.write(toReading(c.message, deviceOf(c)))
    await influx.flush()

    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('/api/v2/write?org=&bucket=homy%2Fautogen&precision=ms')
    expect(requests[0].authorization).toBe('Token writer:secret')
    expect(requests[0].body.split('\n')).toStrictEqual(CASES.map((c) => c.point))
  })

  it('stores a field named "time" as "device_time" and a string value as a tag', async () => {
    const influx = writer()
    influx.write({time: 1792281698, mode: 'auto', _tz: 1792281698680, _addr: 3, _type: 'x', device: 'd'})
    await influx.flush()

    expect(requests[0].body).toBe('raw,bus=secondary,device.addr=3,device.name=d,device.type=x,mode=auto ' +
      'device_time=1792281698 1792281698680')
  })
})
