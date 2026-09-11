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
