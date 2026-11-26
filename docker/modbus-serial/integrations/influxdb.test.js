const {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest} = require('@jest/globals')

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

describe('influxdb close', () => {
  // MSW is an ES module: it is loaded with import(), which needs the test
  // script's --experimental-vm-modules.
  let http, HttpResponse, server
  const url = 'http://influxdb.test'
  let bodies
  let statuses

  const reading = {device: 'main', _type: 'sdm630', _addr: 1, _tz: 1700000000000, v: 230}
  const create = () => createInfluxIntegration({url, database: 'homy', measurement: 'raw'})

  beforeAll(async () => {
    const msw = await import('msw')
    const {setupServer} = await import('msw/node')
    http = msw.http
    HttpResponse = msw.HttpResponse
    server = setupServer()
    server.listen({onUnhandledRequest: 'error'})
  })
  afterAll(() => server.close())

  beforeEach(() => {
    bodies = []
    // One status per request; the last one repeats.
    statuses = [204]
    // Use the real client, so the test sees what is really sent over HTTP.
    const actual = jest.requireActual('@influxdata/influxdb-client')
    InfluxDB.mockImplementation((opts) => new actual.InfluxDB(opts))
    server.use(http.post(`${url}/api/v2/write`, async ({request}) => {
      bodies.push(await request.text())
      const status = statuses.length > 1 ? statuses.shift() : statuses[0]
      return new HttpResponse(null, {status})
    }))
  })

  afterEach(() => server.resetHandlers())

  it('sends a pending point when closed, long before the batch interval', async () => {
    const {publish, close} = create()

    publish(reading)
    expect(bodies).toHaveLength(0)

    await close()

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('v=230')
  })

  it('closes at once after a point with no fields, which the client drops', async () => {
    const {publish, close} = create()

    publish({device: 'main', _type: 'sdm630', _addr: 1, _tz: 1700000000000, _ms: 5})
    const result = await Promise.race([
      close().then(() => 'closed', (e) => `rejected: ${e.message}`),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 1000)),
    ])

    expect(result).toBe('closed')
    expect(bodies).toHaveLength(0)
  })

  it('sends a point that waits for a retry', async () => {
    statuses = [503, 204]
    const {publish, close} = create()

    publish(reading)
    await close()

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toContain('v=230')
  })

  it('rejects when the point cannot be delivered', async () => {
    statuses = [503]
    const {publish, close} = create()

    publish(reading)

    await expect(close()).rejects.toThrow('1 points were not written')
  })

  it('waits for a write that is still in flight', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    server.use(http.post(`${url}/api/v2/write`, async ({request}) => {
      bodies.push(await request.text())
      await gate
      return new HttpResponse(null, {status: 204})
    }))
    const {publish, close} = create()
    publish(reading)

    let closed = false
    const closing = close().then(() => { closed = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(bodies).toHaveLength(1)
    expect(closed).toBe(false)

    release()
    await closing
    expect(closed).toBe(true)
  })
})

describe('influxdb close after a write that is not retried', () => {
  const {HttpError} = jest.requireActual('@influxdata/influxdb-client')
  const reading = {device: 'main', _type: 'sdm630', _addr: 1, _tz: 1700000000000, v: 230}
  let options
  let onFlush

  const create = () => {
    onFlush = async () => {}
    InfluxDB.mockImplementation(() => ({
      getWriteApi: (org, bucket, precision, opts) => {
        options = opts
        return {
          closed: false,
          writePoint: () => {},
          flush: async () => onFlush(),
          close: async () => {},
        }
      },
    }))
    return createInfluxIntegration({url: 'http://influxdb', database: 'homy'})
  }
  const httpError = (status, json) => new HttpError(status, 'status', JSON.stringify(json || {}), '0', 'application/json')
  // close() must not wait for the 5 s deadline of the caller.
  const closesAtOnce = async (close) => {
    const result = await Promise.race([
      close().then(() => 'closed', (e) => `rejected: ${e.message}`),
      new Promise((resolve) => setTimeout(() => resolve('hangs'), 500)),
    ])
    expect(result).toBe('closed')
  }

  it('counts a write that InfluxDB rejects with a 400 as lost', async () => {
    const {publish, close} = create()
    publish(reading)
    options.writeFailed(httpError(400, {error: 'unable to parse'}), ['line'], 1, Date.now() + 10000)

    await closesAtOnce(close)
  })

  it('counts a write whose last retry failed as lost', async () => {
    const {publish, close} = create()
    publish(reading)
    options.writeFailed(httpError(503), ['line'], 6, Date.now() + 10000)

    await closesAtOnce(close)
  })

  it('counts a write that ran out of retry time as lost', async () => {
    const {publish, close} = create()
    publish(reading)
    options.writeFailed(new Error('Max retry time exceeded.'), ['line'], 2, Date.now() - 1)

    await closesAtOnce(close)
  })

  it('does not count a write that waits for a retry as lost', async () => {
    const {publish, close} = create()
    publish(reading)
    options.writeFailed(httpError(503), ['line'], 1, Date.now() + 10000)
    // Each flush in close() retries the line, and the retry fails again.
    onFlush = async () => options.writeFailed(new Error('socket hang up'), ['line'], 2, Date.now() + 10000)

    await expect(close()).rejects.toThrow('1 points were not written')
  })

  it('does not count a write as lost that the client counts as written', async () => {
    const {publish, close} = create()
    publish(reading)
    options.writeFailed(httpError(500, {error: 'hinted handoff queue not empty'}), ['line'], 1, Date.now() + 10000)
    options.writeSuccess(['line'])

    await closesAtOnce(close)
  })
})
