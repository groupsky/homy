import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyRows, describeRegistryChanges, fillGrafanaLinks, planExposure, planFullDashboard, planRegistryNames } from './lib.mjs'

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

const IONIQ = { title: 'Ioniq', icon: 'mdi:car-electric', config: { views: [{ title: 'Ioniq', cards: [{ type: 'markdown', content: 'x' }] }] } }

test('creates a missing full dashboard and saves its config', () => {
  assert.deepEqual(planFullDashboard('dashboard-ioniq', undefined, null, IONIQ), {
    create: { url_path: 'dashboard-ioniq', title: 'Ioniq', icon: 'mdi:car-electric', show_in_sidebar: true, require_admin: false },
    save: true
  })
})

test('saves a full dashboard whose config differs, and only then', () => {
  const existing = { url_path: 'dashboard-ioniq', mode: 'storage' }
  assert.deepEqual(planFullDashboard('dashboard-ioniq', existing, { views: [] }, IONIQ), { create: null, save: true })
  assert.deepEqual(planFullDashboard('dashboard-ioniq', existing, structuredClone(IONIQ.config), IONIQ), { create: null, save: false })
})

test('saves an existing full dashboard that has no config yet', () => {
  assert.deepEqual(planFullDashboard('dashboard-ioniq', { url_path: 'dashboard-ioniq', mode: 'storage' }, null, IONIQ), { create: null, save: true })
})

test('refuses a full dashboard that is in YAML mode', () => {
  assert.throws(() => planFullDashboard('dashboard-ioniq', { url_path: 'dashboard-ioniq', mode: 'yaml' }, null, IONIQ), /YAML mode/)
})

test('refuses a url_path without a hyphen and an entry with both rows and config', () => {
  assert.throws(() => planFullDashboard('ioniq', undefined, null, IONIQ), /hyphen/)
  assert.throws(() => planFullDashboard('dashboard-ioniq', undefined, null, { ...IONIQ, rows: [] }), /both/)
})

const LINKS = { views: [{ cards: [{ type: 'markdown', content: 'Grafana:\n[Общо](grafana:/d/ioniq-overview) · [Гуми](grafana:/d/ioniq-tires)' }] }] }

test('leaves only the dashboard names when the Grafana base URL is empty or missing', () => {
  for (const base of ['', '  ', undefined]) {
    assert.equal(fillGrafanaLinks(LINKS, base).views[0].cards[0].content, 'Grafana:\nОбщо · Гуми')
  }
})

test('links the dashboard names to the Grafana base URL when it is set', () => {
  for (const base of ['https://grafana.example.com', 'https://grafana.example.com/']) {
    assert.equal(fillGrafanaLinks(LINKS, base).views[0].cards[0].content,
      'Grafana:\n[Общо](https://grafana.example.com/d/ioniq-overview) · [Гуми](https://grafana.example.com/d/ioniq-tires)')
  }
})

test('does not mutate the config it fills in', () => {
  const config = structuredClone(LINKS)
  fillGrafanaLinks(config, 'https://grafana.example.com')
  assert.deepEqual(config, LINKS)
})

const registryDevices = [{ id: 'dev1', name: 'living-temp-humid', name_by_user: null }]
const registryEntities = new Map([
  ['sensor.room_temperature', { entity_id: 'sensor.room_temperature', device_id: 'dev1', name: null }],
  ['sensor.room_humidity', { entity_id: 'sensor.room_humidity', device_id: 'dev1', name: null }]
])

test('plans the device and entity names that differ, and prints them old -> new in a dry run', () => {
  const plan = planRegistryNames({
    'sensor.room_temperature': { device: 'Хол', name: 'Температура' },
    'sensor.room_humidity': { device: 'Хол', name: 'Влажност' }
  }, registryEntities, registryDevices)

  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.deviceChanges, [{ deviceId: 'dev1', device: 'living-temp-humid', entityId: 'sensor.room_temperature', from: null, to: 'Хол' }])
  assert.deepEqual(describeRegistryChanges(plan, true), [
    'registry: would set name_by_user of device living-temp-humid (of sensor.room_temperature): null -> "Хол"',
    'registry: would set name of sensor.room_temperature: null -> "Температура"',
    'registry: would set name of sensor.room_humidity: null -> "Влажност"'
  ])
})

test('plans no write when the registry names are already set', () => {
  const entities = new Map([['sensor.room_temperature', { ...registryEntities.get('sensor.room_temperature'), name: 'Температура' }]])
  const devices = [{ ...registryDevices[0], name_by_user: 'Хол' }]

  const plan = planRegistryNames({ 'sensor.room_temperature': { device: 'Хол', name: 'Температура' } }, entities, devices)

  assert.deepEqual(plan, { entityChanges: [], deviceChanges: [], errors: [] })
  assert.deepEqual(describeRegistryChanges(plan, true), [])
})

test('names only the device when the entity has no name of its own', () => {
  const plan = planRegistryNames({ 'sensor.room_temperature': { device: 'Хол' } }, registryEntities, registryDevices)

  assert.deepEqual(plan.entityChanges, [])
  assert.equal(plan.deviceChanges.length, 1)
})

test('reports an entity not in the registry, without a device, or a device with two names', () => {
  const entities = new Map([...registryEntities, ['sensor.template', { entity_id: 'sensor.template', device_id: null, name: null }]])

  const plan = planRegistryNames({
    'sensor.gone': { name: 'X' },
    'sensor.template': { device: 'Хол' },
    'sensor.room_temperature': { device: 'Хол' },
    'sensor.room_humidity': { device: 'Кухня' }
  }, entities, registryDevices)

  assert.deepEqual(plan.errors, [
    'sensor.gone: not in the entity registry',
    'sensor.template: has no device to name',
    'sensor.room_humidity: device living-temp-humid is named both "Хол" (by sensor.room_temperature) and "Кухня"'
  ])
})
