// Pure planning functions for ha-provision; index.mjs does the I/O.
import { isDeepStrictEqual } from 'node:util'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const rowEntity = (row) => (typeof row === 'string' ? row : isObject(row) ? row.entity : undefined)

/**
 * Replaces, in a copy of a Lovelace dashboard config, every row of an
 * `entities` card whose entity has a desired row.
 *
 * - `changes`: rows replaced, with their path and previous value
 * - `missing`: desired entities that are on no `entities` card
 * - `unmanaged`: every other place the entity id appears (tile, button and
 *   glance cards, badges, conditions...), which a row's confirmation does not
 *   cover and which must not be edited blindly
 */
export function applyRows (config, rows) {
  const desired = new Map(rows.map((row) => {
    if (typeof row?.entity !== 'string') throw new Error(`desired row without an entity: ${JSON.stringify(row)}`)
    return [row.entity, row]
  }))
  const result = structuredClone(config)
  const changes = []
  const unmanaged = []
  const found = new Set()

  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (desired.has(node)) unmanaged.push({ entity: node, path: path.join('/') })
      return
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...path, i]))
      return
    }
    if (!isObject(node)) return
    for (const [key, value] of Object.entries(node)) {
      const here = [...path, key]
      if (key === 'entities' && node.type === 'entities' && Array.isArray(value)) {
        value.forEach((row, i) => {
          const entity = rowEntity(row)
          if (!desired.has(entity)) {
            walk(row, [...here, i])
            return
          }
          found.add(entity)
          const after = structuredClone(desired.get(entity))
          if (!isDeepStrictEqual(row, after)) {
            changes.push({ entity, path: [...here, i].join('/'), before: row, after })
            value[i] = after
          }
        })
      } else {
        walk(value, here)
      }
    }
  }

  walk(result, [])
  const missing = [...desired.keys()].filter((entity) => !found.has(entity))
  return { config: result, changes, missing, unmanaged }
}

/**
 * Lists the expose calls needed to move `current` (the result of
 * `homeassistant/expose_entity/list`, which names only exposed entities) to
 * `desired` (`{ assistant: { entity_id: should_expose } }`).
 */
export function planExposure (current, desired) {
  const plan = []
  for (const [assistant, entities] of Object.entries(desired)) {
    for (const [entityId, to] of Object.entries(entities)) {
      const from = current?.[entityId]?.[assistant] === true
      if (from !== to) plan.push({ assistant, entityId, from, to })
    }
  }
  return plan
}

/**
 * Plans a dashboard that the repo owns in full (`dashboards.<url_path>.config`
 * in provision.json, #1800): create it when it is missing, and save the whole
 * config when it differs. Edits made in the UI are replaced on the next run.
 *
 * - `existing`: the entry for `urlPath` from `lovelace/dashboards/list`, if any
 * - `current`: its config from `lovelace/config`, or null when it has none
 */
export function planFullDashboard (urlPath, existing, current, desired) {
  if (!urlPath.includes('-')) throw new Error(`dashboard ${urlPath}: a new dashboard's url_path needs a hyphen`)
  if (desired.rows) throw new Error(`dashboard ${urlPath}: has both rows and config; use one`)
  if (existing && existing.mode !== 'storage') throw new Error(`dashboard ${urlPath}: is in YAML mode and cannot be saved`)
  const create = existing
    ? null
    : { url_path: urlPath, title: desired.title, icon: desired.icon, show_in_sidebar: true, require_admin: false }
  return { create, save: !isDeepStrictEqual(current, desired.config) }
}

/**
 * Resolves, in a copy of a dashboard config, every markdown link written as
 * `[name](grafana:/path)`. With `baseUrl` set it becomes a link to
 * `baseUrl/path`; with it empty or missing only the name is left, so a phone
 * shows no broken link (#1844). The base URL lives in the private .env, so no
 * host name is in the repo.
 */
export function fillGrafanaLinks (config, baseUrl) {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '')
  const fill = (node) => {
    if (typeof node === 'string') {
      return node.replace(/\[([^\]]*)\]\(grafana:(\/[^)\s]*)\)/g, (_, name, path) => (base ? `[${name}](${base}${path})` : name))
    }
    if (Array.isArray(node)) return node.map(fill)
    if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, fill(value)]))
    return node
  }
  return fill(config)
}

/**
 * Plans the registry names (`registry_names` in provision.json, #1849):
 * `{ entity_id: { name, device } }`, where `name` is the entity registry name
 * and `device` the `name_by_user` of the entity's device. Either may be left
 * out. Only values that differ are planned; entity ids are never changed.
 *
 * - `entities`: a Map of entity_id to the entry from
 *   `config/entity_registry/get`, with no key for an entity not in the registry
 * - `devices`: the list from `config/device_registry/list`
 *
 * `errors` lists entities that cannot be named: not in the registry, without
 * a device, or a device given two different names.
 */
export function planRegistryNames (desired, entities, devices) {
  const byId = new Map(devices.map((device) => [device.id, device]))
  const entityChanges = []
  const deviceChanges = []
  const errors = []
  const deviceNames = new Map()
  for (const [entityId, want] of Object.entries(desired)) {
    const entry = entities.get(entityId)
    if (!entry) {
      errors.push(`${entityId}: not in the entity registry`)
      continue
    }
    if (want.name !== undefined && entry.name !== want.name) {
      entityChanges.push({ entityId, from: entry.name, to: want.name })
    }
    if (want.device === undefined) continue
    const device = byId.get(entry.device_id)
    if (!device) {
      errors.push(`${entityId}: has no device to name`)
      continue
    }
    const seen = deviceNames.get(device.id)
    if (seen && seen.to !== want.device) {
      errors.push(`${entityId}: device ${device.name} is named both ${JSON.stringify(seen.to)} (by ${seen.entityId}) and ${JSON.stringify(want.device)}`)
      continue
    }
    if (seen) continue
    deviceNames.set(device.id, { entityId, to: want.device })
    if (device.name_by_user !== want.device) {
      deviceChanges.push({ deviceId: device.id, device: device.name, entityId, from: device.name_by_user, to: want.device })
    }
  }
  return { entityChanges, deviceChanges, errors }
}

/** One output line per planned registry change: old -> new. */
export function describeRegistryChanges ({ entityChanges, deviceChanges }, dryRun) {
  const verb = dryRun ? 'would set' : 'set'
  return [
    ...deviceChanges.map((c) => `registry: ${verb} name_by_user of device ${c.device} (of ${c.entityId}): ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`),
    ...entityChanges.map((c) => `registry: ${verb} name of ${c.entityId}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`)
  ]
}
