import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyRows, planExposure } from './lib.mjs'

const RELAY = 'switch.relay'
const desiredRow = {
  entity: RELAY,
  type: 'simple-entity',
  tap_action: { action: 'toggle', confirmation: { text: 'Continue?' } },
  hold_action: { action: 'none' }
}

const dashboard = (cards) => ({ views: [{ type: 'sections', sections: [{ type: 'grid', cards }] }] })

test('replaces the row for the entity in an entities card and reports before/after', () => {
  const before = { entity: RELAY, name: 'Relay' }
  const config = dashboard([{ type: 'entities', entities: ['light.a', before, { entity: 'light.b' }] }])

  const result = applyRows(config, [desiredRow])

  assert.deepEqual(result.config.views[0].sections[0].cards[0].entities, ['light.a', desiredRow, { entity: 'light.b' }])
  assert.deepEqual(result.changes, [{ entity: RELAY, path: 'views/0/sections/0/cards/0/entities/1', before, after: desiredRow }])
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.unmanaged, [])
})

test('replaces a row written in the short string form', () => {
  const config = dashboard([{ type: 'entities', entities: [RELAY] }])

  const result = applyRows(config, [desiredRow])

  assert.deepEqual(result.config.views[0].sections[0].cards[0].entities, [desiredRow])
  assert.equal(result.changes[0].before, RELAY)
})

test('reports no change when the row already matches', () => {
  const config = dashboard([{ type: 'entities', entities: [structuredClone(desiredRow)] }])

  const result = applyRows(config, [desiredRow])

  assert.deepEqual(result.changes, [])
  assert.deepEqual(result.config, config)
})

test('does not mutate the config it is given', () => {
  const config = dashboard([{ type: 'entities', entities: [{ entity: RELAY }] }])
  const snapshot = structuredClone(config)

  applyRows(config, [desiredRow])

  assert.deepEqual(config, snapshot)
})

test('reports a desired row whose entity is on no entities card as missing', () => {
  const config = dashboard([{ type: 'entities', entities: ['light.a'] }])

  const result = applyRows(config, [desiredRow])

  assert.deepEqual(result.missing, [RELAY])
  assert.deepEqual(result.changes, [])
})

test('reports the entity outside an entities-card row as unmanaged', () => {
  // A tile card toggles on icon tap and a glance card opens more-info; neither
  // honours a row's confirmation, so they must be surfaced rather than edited.
  const config = dashboard([
    { type: 'entities', entities: [{ entity: RELAY }] },
    { type: 'tile', entity: RELAY },
    { type: 'glance', entities: [RELAY] }
  ])

  const result = applyRows(config, [desiredRow])

  assert.deepEqual(result.unmanaged.map((u) => u.path), [
    'views/0/sections/0/cards/1/entity',
    'views/0/sections/0/cards/2/entities/0'
  ])
  assert.equal(result.changes.length, 1)
})

test('finds rows in entities cards nested inside stacks', () => {
  const config = dashboard([{ type: 'vertical-stack', cards: [{ type: 'entities', entities: [{ entity: RELAY }] }] }])

  const result = applyRows(config, [desiredRow])

  assert.equal(result.changes[0].path, 'views/0/sections/0/cards/0/cards/0/entities/0')
})

test('plans only the exposure calls whose state differs', () => {
  const current = { [RELAY]: { conversation: true }, 'light.a': { conversation: true } }
  const desired = { conversation: { [RELAY]: false, 'light.a': true, 'light.b': false } }

  assert.deepEqual(planExposure(current, desired), [
    { assistant: 'conversation', entityId: RELAY, from: true, to: false }
  ])
})
