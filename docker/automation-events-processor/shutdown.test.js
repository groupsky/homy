const http = require('http')
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const createShutdown = require('./shutdown')

// A real write API against a local HTTP server: no InfluxDB mock, so the test
// shows that close() really sends the batch.
const startServer = (handler) => new Promise((resolve) => {
  const sockets = new Set()
  const server = http.createServer(handler)
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(r) }),
  }))
})

const newWriteApi = (url) =>
  new InfluxDB({url, token: 't'}).getWriteApi('', 'db/autogen', 'ms', {batchSize: 1000, flushInterval: 60000})

describe('shutdown', () => {
  let server
  afterEach(async () => { if (server) await server.stop(); server = null })

  it('sends a pending point before it exits', async () => {
    const bodies = []
    server = await startServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { bodies.push(body); res.statusCode = 204; res.end() })
    })
    const writeApi = newWriteApi(server.url)
    writeApi.writePoint(new Point('m').floatField('v', 1).timestamp(1000))
    expect(bodies).toEqual([])

    const exit = jest.fn(() => { expect(bodies.join('')).toContain('m v=1') })
    await createShutdown({writeApis: [writeApi], exit, log: () => {}})('SIGTERM')

    expect(exit).toHaveBeenCalledWith(0)
  })

  it('stops the input first and exits only once', async () => {
    const events = []
    const exit = jest.fn((c) => events.push(`exit ${c}`))
    const shutdown = createShutdown({
      writeApis: [{close: async () => { events.push('close') }}],
      stop: () => events.push('stop'),
      exit,
      log: () => {},
    })
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')])
    expect(events).toEqual(['stop', 'close', 'exit 0'])
  })

  it('does not wait longer than the timeout for a stuck InfluxDB', async () => {
    server = await startServer(() => { /* never answers */ })
    const writeApi = newWriteApi(server.url)
    writeApi.writePoint(new Point('m').floatField('v', 1).timestamp(1000))

    const exit = jest.fn()
    const start = Date.now()
    await createShutdown({writeApis: [writeApi], exit, log: () => {}, msTimeout: 300})('SIGTERM')

    expect(Date.now() - start).toBeLessThan(2000)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
