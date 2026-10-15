// One reader per serial port.
//
// Two programs on one RS-485 port answer each other's requests and corrupt
// each other's reads. The old reader (modbus-serial) names its port in the
// config file mounted at /etc/config.js; the ya-modbus bridge names its ports
// in the JSON file mounted at /etc/ya-modbus/config.json. This reads them from
// the resolved compose config and checks that each port has one reader.
// Needs docker (compose v2), not the images.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

const config = JSON.parse(execFileSync('docker', ['compose', '--env-file', 'example.env', 'config', '--format', 'json'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))

const imageName = (image) => String(image ?? '').replace(/@.*$/, '').split('/').pop().replace(/:.*$/, '')

function mountSource (name, service, target) {
  const source = (service.volumes ?? []).find((v) => v.target === target)?.source
  if (!source) throw new Error(`${name}: nothing is mounted at ${target}`)
  return source
}

// { service, image, port } for each serial port a service reads.
function serialReaders () {
  const readers = []
  for (const [name, service] of Object.entries(config.services)) {
    const image = imageName(service.image)
    if (image === 'modbus-serial') {
      const { modbus } = require(mountSource(name, service, '/etc/config.js'))
      if ((modbus.type ?? 'rtu') === 'rtu') readers.push({ service: name, image, port: modbus.port })
    } else if (image === 'ya-modbus-bridge') {
      const { devices = [] } = JSON.parse(readFileSync(mountSource(name, service, '/etc/ya-modbus/config.json'), 'utf8'))
      const ports = new Set(devices.filter((d) => d.connection.type === 'rtu').map((d) => d.connection.port))
      for (const port of ports) readers.push({ service: name, image, port })
    }
  }
  return readers
}

const readers = serialReaders()

test('every serial port has one reader', () => {
  assert.ok(readers.length > 0)
  const byPort = new Map()
  for (const r of readers) byPort.set(r.port, [...(byPort.get(r.port) ?? []), r])
  const shared = [...byPort].filter(([, list]) => list.length > 1)
    .map(([port, list]) => `${port}: ${list.map((r) => `${r.service} (${r.image})`).join(', ')}`)
  assert.deepEqual(shared, [])
})

// The port of a moved bus is the one in the old reader's config, which stays
// in the repo for the move back (docs/ya-modbus.md).
for (const bus of ['tetriary', 'main']) {
  test(`the ${bus} port is read by the ya-modbus bridge, not by the old reader`, () => {
    const { modbus: { port } } = require(join(root, `config/modbus-serial/${bus}.config.js`))
    assert.deepEqual(readers.filter((r) => r.port === port), [{ service: `${bus}-power`, image: 'ya-modbus-bridge', port }])
  })
}
