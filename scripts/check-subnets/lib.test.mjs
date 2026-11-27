import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findConflicts, parseRoutes, wantedSubnets } from './lib.mjs'

const compose = {
  name: 'homy',
  networks: {
    dmz: { name: 'homy_dmz', ipam: { config: [{ subnet: '10.28.28.0/24' }] } },
    ingress: { name: 'homy_ingress', ipam: { config: [{ subnet: '10.28.29.0/24', ip_range: '10.28.29.128/25' }] } },
    plain: { name: 'homy_plain' }
  },
  services: { vpn: { environment: { INTERNAL_SUBNET: '10.13.13.0' } } }
}
const net = (name, ...subnets) => ({ Name: name, IPAM: { Config: subnets.map((Subnet) => ({ Subnet })) } })

test('wantedSubnets lists the pinned networks only, plus the WireGuard range', () => {
  assert.deepEqual(wantedSubnets(compose), [
    { what: 'network homy_dmz', name: 'homy_dmz', cidr: '10.28.28.0/24' },
    { what: 'network homy_ingress', name: 'homy_ingress', cidr: '10.28.29.0/24' },
    { what: 'the WireGuard range', name: null, cidr: '10.13.13.0/24' }
  ])
})

test('a host that matches the repo has no conflicts', () => {
  const nets = [net('homy_dmz', '10.28.28.0/24'), net('homy_ingress', '10.28.29.0/24'), net('bridge', '172.17.0.0/16')]
  assert.deepEqual(findConflicts({ compose, networks: nets, routes: [] }), [])
})

test('the host dmz /16 swallows the pinned ingress subnet (the #1558 case)', () => {
  const nets = [net('homy_dmz', '10.28.0.0/16')]
  const out = findConflicts({ compose, networks: nets, routes: [] })
  assert.equal(out.length, 1)
  assert.match(out[0], /network homy_ingress \(10\.28\.29\.0\/24\) overlaps the existing Docker network homy_dmz \(10\.28\.0\.0\/16\)/)
})

test('the network being recreated is not a conflict with itself', () => {
  const nets = [net('homy_ingress', '10.28.29.0/24'), net('homy_dmz', '10.99.0.0/24')]
  assert.deepEqual(findConflicts({ compose, networks: nets, routes: [] }), [])
})

test('a host route that is not a Docker bridge conflicts', () => {
  const routes = parseRoutes('default via 192.0.2.1 dev eth0\n10.28.29.0/25 dev tun0 scope link\n')
  const out = findConflicts({ compose, networks: [], routes })
  assert.equal(out.length, 1)
  assert.match(out[0], /host route 10\.28\.29\.0\/25 \(dev tun0\)/)
})

test('routes through Docker bridges are covered by the network list', () => {
  const routes = parseRoutes('10.28.29.0/24 dev br-1a2b3c proto kernel\n172.17.0.0/16 dev docker0 proto kernel\n')
  assert.deepEqual(findConflicts({ compose, networks: [], routes }), [])
})

test('two pinned subnets that overlap each other conflict', () => {
  const bad = structuredClone(compose)
  bad.networks.ingress.ipam.config[0].subnet = '10.28.28.128/25'
  const out = findConflicts({ compose: bad, networks: [], routes: [] })
  assert.match(out.join('\n'), /network homy_dmz \(10\.28\.28\.0\/24\) overlaps network homy_ingress/)
})

test('a malformed pinned subnet is an error, not a silent pass', () => {
  const bad = structuredClone(compose)
  bad.networks.ingress.ipam.config[0].subnet = '10.28.29.0'
  assert.match(findConflicts({ compose: bad, networks: [], routes: [] })[0], /not a valid IPv4 CIDR/)
})

test('a pinned subnet left empty by a missing variable is an error', () => {
  const bad = structuredClone(compose)
  bad.networks.ingress.ipam.config[0].subnet = ''
  assert.match(findConflicts({ compose: bad, networks: [], routes: [] })[0], /not a valid IPv4 CIDR/)
})

test('parseRoutes: host routes get /32, default and blackhole noise is skipped', () => {
  assert.deepEqual(parseRoutes('default via 1.1.1.1 dev eth0\n192.0.2.7 dev eth1\n\nbroadcast 10.0.0.255 dev x\n'), [
    { cidr: '192.0.2.7/32', dev: 'eth1' }
  ])
})
