const {afterEach, beforeEach, describe, expect, it} = require('@jest/globals')
const {spawn} = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')

// Runs the real service as a process, with a fake bus and a fake InfluxDB, and
// stops it with SIGTERM like `docker stop` does (#1971). The child is a separate
// process, so MSW cannot see its requests: a local HTTP server stands in.
describe('service stop', () => {
  const host = 'localhost'
  let dir
  let bus
  let influx
  let bodies
  let child

  const listen = (server) => new Promise((resolve) => server.listen(0, host, resolve))

  beforeEach(async () => {
    bodies = []
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-serial-'))
    bus = net.createServer((socket) => socket.on('error', () => {}))
    influx = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        bodies.push(body)
        res.statusCode = 204
        res.end()
      })
    })
    await Promise.all([listen(bus), listen(influx)])
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      modbus: {type: 'tcp', port: host, portConfig: {port: bus.address().port}},
      devices: [{name: 'main', type: '../test-fixtures/fake-device', address: 1}],
      integrations: {
        influxdb: {url: `http://${host}:${influx.address().port}`, database: 'homy', measurement: 'raw'},
      },
    }))
  })

  afterEach(async () => {
    if (child && child.exitCode === null) child.kill('SIGKILL')
    await Promise.all([
      new Promise((resolve) => bus.close(resolve)),
      new Promise((resolve) => influx.close(resolve)),
    ])
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('sends the pending point to InfluxDB on SIGTERM and exits 0 within 10 s', async () => {
    child = spawn('node', ['index.js'], {
      cwd: __dirname,
      env: {...process.env, CONFIG: path.join(dir, 'config.json')},
    })
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({code, signal})))
    await new Promise((resolve) => {
      let out = ''
      child.stdout.on('data', (chunk) => {
        out += chunk
        if (out.includes('read')) resolve()
      })
    })
    expect(bodies).toHaveLength(0)

    const start = Date.now()
    child.kill('SIGTERM')
    const {code, signal} = await exited

    expect(signal).toBeNull()
    expect(code).toBe(0)
    expect(Date.now() - start).toBeLessThan(10000)
    expect(bodies.join('\n')).toContain('v=230')
  }, 20000)
})
