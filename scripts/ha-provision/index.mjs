#!/usr/bin/env node
// Applies config/home-assistant/provision.json to a running Home Assistant:
// the state HA keeps only in .storage and offers no YAML for - rows of
// storage-mode dashboards, whole dashboards the repo owns, and entity
// exposure to assistants. Safe to re-run;
// --dry-run reports what would change and writes nothing. See README.md.
import { readFileSync } from 'node:fs'
import { applyRows, planExposure, planFullDashboard } from './lib.mjs'
import { connect, readToken } from './ha-websocket.mjs'

// Fixed on purpose, not configurable: the script only ever talks to the HA
// container over the automation network, reads the repo's desired state and
// takes its admin token from the Docker secret mount.
const HA_URL = 'ws://ha:8123/api/websocket'
const TOKEN_FILE = '/run/secrets/ha_provision_token'
const DESIRED = new URL('../../config/home-assistant/provision.json', import.meta.url)

async function provisionExposure (ha, desired, dryRun) {
  const { exposed_entities: current } = await ha.call({ type: 'homeassistant/expose_entity/list' })
  const plan = planExposure(current, desired)
  for (const { assistant, entityId, from, to } of plan) {
    console.log(`${dryRun ? 'would expose' : 'expose'} ${entityId} to ${assistant}: ${from} -> ${to}`)
    if (!dryRun) {
      await ha.call({ type: 'homeassistant/expose_entity', assistants: [assistant], entity_ids: [entityId], should_expose: to })
    }
  }
  if (plan.length === 0) console.log('exposure: up to date')
}

// Returns false when the dashboard cannot be brought to the desired state
// without a human deciding where the entity belongs.
async function provisionDashboard (ha, urlPath, rows, dryRun) {
  const config = await ha.call({ type: 'lovelace/config', url_path: urlPath })
  const result = applyRows(config, rows)
  let ok = true
  for (const entity of result.missing) {
    console.error(`dashboard ${urlPath}: ${entity} is on no entities card - add it in the UI, then re-run`)
    ok = false
  }
  for (const { entity, path } of result.unmanaged) {
    console.error(`dashboard ${urlPath}: ${entity} also appears at ${path}, which a row's confirmation does not cover`)
    ok = false
  }
  if (!ok) return false
  for (const { entity, path, before, after } of result.changes) {
    // The previous row is printed in full so a run's output is its own rollback.
    console.log(`dashboard ${urlPath}: ${dryRun ? 'would replace' : 'replace'} ${entity} at ${path}`)
    console.log(`  before: ${JSON.stringify(before)}`)
    console.log(`  after:  ${JSON.stringify(after)}`)
  }
  if (result.changes.length === 0) {
    console.log(`dashboard ${urlPath}: up to date`)
  } else if (!dryRun) {
    await ha.call({ type: 'lovelace/config/save', url_path: urlPath, config: result.config })
  }
  return true
}

// A dashboard the repo owns in full: created when missing, saved when it
// differs (#1800).
async function provisionFullDashboard (ha, urlPath, desired, dryRun) {
  const dashboards = await ha.call({ type: 'lovelace/dashboards/list' })
  const existing = dashboards.find((d) => d.url_path === urlPath)
  let current = null
  if (existing) {
    try {
      current = await ha.call({ type: 'lovelace/config', url_path: urlPath })
    } catch (err) {
      if (!/config_not_found/.test(err.message)) throw err
    }
  }
  const plan = planFullDashboard(urlPath, existing, current, desired)
  if (plan.create) {
    console.log(`dashboard ${urlPath}: ${dryRun ? 'would create' : 'create'} ${JSON.stringify(plan.create)}`)
    if (!dryRun) await ha.call({ type: 'lovelace/dashboards/create', ...plan.create })
  }
  if (!plan.save) {
    console.log(`dashboard ${urlPath}: up to date`)
    return
  }
  // The previous config is printed in full so a run's output is its own rollback.
  console.log(`dashboard ${urlPath}: ${dryRun ? 'would save' : 'save'} the config from provision.json`)
  console.log(`  before: ${JSON.stringify(current)}`)
  if (!dryRun) await ha.call({ type: 'lovelace/config/save', url_path: urlPath, config: desired.config })
}

async function main () {
  const dryRun = process.argv.slice(2).includes('--dry-run')
  const desired = JSON.parse(readFileSync(DESIRED, 'utf8'))

  const ha = await connect(HA_URL, readToken(TOKEN_FILE))
  try {
    await provisionExposure(ha, desired.exposure ?? {}, dryRun)
    let ok = true
    for (const [urlPath, entry] of Object.entries(desired.dashboards ?? {})) {
      if (entry.config) await provisionFullDashboard(ha, urlPath, entry, dryRun)
      else ok = (await provisionDashboard(ha, urlPath, entry.rows, dryRun)) && ok
    }
    return ok ? 0 : 1
  } finally {
    ha.close()
  }
}

main().then(
  (code) => { process.exitCode = code },
  // Line breaks are removed so an error carrying text from HA stays one log line.
  (err) => { console.error(String(err.message).replace(/\r/g, '').replace(/\n/g, '')); process.exitCode = 1 }
)
