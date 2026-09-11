#!/usr/bin/env node
// Applies config/home-assistant/provision.json to a running Home Assistant:
// the state HA keeps only in .storage and offers no YAML for - rows of
// storage-mode dashboards and entity exposure to assistants. Safe to re-run;
// --dry-run reports what would change and writes nothing. See README.md.
import { readFileSync } from 'node:fs'
import { applyRows, planExposure } from './lib.mjs'

const DEFAULT_URL = 'ws://ha:8123/api/websocket'
const DEFAULT_DESIRED = new URL('../../config/home-assistant/provision.json', import.meta.url)

function readToken () {
  if (process.env.HA_TOKEN) return process.env.HA_TOKEN.trim()
  if (process.env.HA_TOKEN_FILE) return readFileSync(process.env.HA_TOKEN_FILE, 'utf8').trim()
  throw new Error('set HA_TOKEN or HA_TOKEN_FILE to a long-lived access token of an admin user')
}

function connect (url, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    const client = {
      call: (message) => new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { res, rej, type: message.type })
        ws.send(JSON.stringify({ id, ...message }))
      }),
      close: () => ws.close()
    }
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }))
      } else if (message.type === 'auth_ok') {
        resolve(client)
      } else if (message.type === 'auth_invalid') {
        reject(new Error(`authentication rejected: ${message.message}`))
      } else if (message.type === 'result' && pending.has(message.id)) {
        const { res, rej, type } = pending.get(message.id)
        pending.delete(message.id)
        if (message.success) res(message.result)
        else rej(new Error(`${type} failed: ${message.error?.code} ${message.error?.message}`))
      }
    })
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)))
    ws.addEventListener('close', () => {
      for (const { rej, type } of pending.values()) rej(new Error(`${type}: connection closed`))
      pending.clear()
    })
  })
}

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

async function main () {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const desiredArg = args.find((a) => a.startsWith('--desired='))
  const desired = JSON.parse(readFileSync(desiredArg ? desiredArg.slice('--desired='.length) : DEFAULT_DESIRED, 'utf8'))
  const url = process.env.HA_WS_URL || DEFAULT_URL

  const ha = await connect(url, readToken())
  try {
    await provisionExposure(ha, desired.exposure ?? {}, dryRun)
    let ok = true
    for (const [urlPath, { rows }] of Object.entries(desired.dashboards ?? {})) {
      ok = (await provisionDashboard(ha, urlPath, rows, dryRun)) && ok
    }
    return ok ? 0 : 1
  } finally {
    ha.close()
  }
}

main().then(
  (code) => { process.exitCode = code },
  (err) => { console.error(err.message); process.exitCode = 1 }
)
