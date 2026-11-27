import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cidrsOverlap, ipInCidr, parseCidr, toInt } from './cidr.mjs'

test('toInt parses a dotted quad and rejects odd forms', () => {
  assert.equal(toInt('10.0.0.1'), 167772161)
  for (const bad of ['', '10.0.0', '10.0.0.256', '0x1.0.0.1', '1.2.3.4.5', ' 1.2.3.4']) {
    assert.equal(toInt(bad), null, bad)
  }
})

test('parseCidr rejects a missing or oversized prefix', () => {
  for (const bad of ['10.0.0.0', '10.0.0.0/', '10.0.0.0/33', '10.0.0.0/8/8', 'x/8']) {
    assert.equal(parseCidr(bad), null, bad)
  }
  assert.deepEqual(parseCidr('0.0.0.0/0'), { base: 0, mask: 0 })
})

test('ipInCidr', () => {
  assert.equal(ipInCidr('10.28.29.11', '10.28.29.0/24'), true)
  assert.equal(ipInCidr('10.28.30.11', '10.28.29.0/24'), false)
  assert.equal(ipInCidr('10.28.29.11', 'bad'), false)
})

test('cidrsOverlap finds containment in either direction, not just equality', () => {
  assert.equal(cidrsOverlap('10.28.0.0/16', '10.28.29.0/24'), true)
  assert.equal(cidrsOverlap('10.28.29.0/24', '10.28.0.0/16'), true)
  assert.equal(cidrsOverlap('10.28.29.0/24', '10.28.29.0/24'), true)
  assert.equal(cidrsOverlap('10.28.28.0/24', '10.28.29.0/24'), false)
  assert.equal(cidrsOverlap('0.0.0.0/0', '10.28.29.0/24'), true)
})

test('cidrsOverlap is false for a malformed side, so callers must validate first', () => {
  assert.equal(cidrsOverlap('10.28.0.0/', '10.28.0.0/16'), false)
})
