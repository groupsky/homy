import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const INDEX = fileURLToPath(new URL('./index.mjs', import.meta.url))

function run (t, compose, networks, routes) {
  const dir = mkdtempSync(join(tmpdir(), 'check-subnets-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const files = ['compose.json', 'networks.json', 'routes.txt'].map((f) => join(dir, f))
  writeFileSync(files[0], compose)
  writeFileSync(files[1], networks)
  writeFileSync(files[2], routes)
  return spawnSync(process.execPath, [INDEX, ...files], { encoding: 'utf8' })
}

const compose = JSON.stringify({ name: 'homy', networks: { ingress: { name: 'homy_ingress', ipam: { config: [{ subnet: '10.28.29.0/24' }] } } } })

test('exit 0 when the host is free of the pinned subnet (an empty network list too)', (t) => {
  assert.equal(run(t, compose, '', '').status, 0)
})

test('exit 1 and the conflict on stderr when a host network overlaps', (t) => {
  const networks = JSON.stringify([{ Name: 'homy_dmz', IPAM: { Config: [{ Subnet: '10.28.0.0/16' }] } }])
  const r = run(t, compose, networks, '')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /homy_ingress.*homy_dmz/)
})

test('exit 2 on input that is not JSON', (t) => {
  assert.equal(run(t, 'not json', '', '').status, 2)
})
