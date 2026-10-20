const {beforeEach, describe, expect, it, jest} = require('@jest/globals')

// Only the network client is replaced; Point is the real one, so the test checks
// the line protocol that would really be sent to InfluxDB.
jest.mock('@influxdata/influxdb-client', () => {
  const actual = jest.requireActual('@influxdata/influxdb-client')
  return {...actual, InfluxDB: jest.fn()}
})
const {InfluxDB} = require('@influxdata/influxdb-client')
const {ObjectId} = require('mongodb')
const createInfluxIntegration = require('./influxdb')

describe('influxdb publish', () => {
  let written

  beforeEach(() => {
    written = []
    InfluxDB.mockImplementation(() => ({
      getWriteApi: () => ({writePoint: (point) => written.push(point.toLineProtocol())}),
    }))
  })

  it('writes the device clock as device_time, because InfluxDB 1.x rejects a field named time', () => {
    const {publish} = createInfluxIntegration({url: 'http://influxdb', database: 'homy', measurement: 'xymd1'})

    publish({device: 'charger', _type: 'or-we-526', _addr: 1, _tz: 1700000000000, time: 1699999999000, v: 230})

    expect(written).toHaveLength(1)
    expect(written[0]).toContain('device_time=1699999999000')
    expect(written[0]).not.toMatch(/[ ,]time=/)
    expect(written[0]).toContain('v=230')
    expect(written[0]).toMatch(/ 1700000000000$/)
  })

  it('does not write the _id that the mongodb integration adds to the shared reading', () => {
    const {publish} = createInfluxIntegration({url: 'http://influxdb', database: 'homy', measurement: 'raw'})

    publish({device: 'main', _type: 'sdm630', _addr: 1, _tz: 1700000000000, v: 230, _id: new ObjectId()})

    expect(written).toHaveLength(1)
    expect(written[0]).not.toContain('_id')
    expect(written[0]).toContain('v=230')
  })
})
