import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FIELDS } from './charges.js'

// The Grafana dashboard "Ioniq EV – Зареждания" reads what this service writes.
const dashboard = JSON.parse(readFileSync(new URL('../../../config/grafana/dashboards/Ioniq EV/ioniq-charges.json', import.meta.url), 'utf8'))
const queries = dashboard.panels.flatMap((p) => (p.targets ?? []).map((t) => ({ panel: p.title, query: t.query, format: t.resultFormat })))
const known = new Set([...FIELDS.map((f) => f.field), 'month', 'place', 'type'])

test('every query reads only the tags and fields of ioniq_charges', () => {
  assert.ok(queries.length > 0)
  for (const { panel, query } of queries) {
    assert.match(query, /FROM "ioniq_charges"/, panel)
    // the quoted names, without the measurement and the AS aliases
    const names = [...query.replace(/ AS "[^"]+"/g, '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((n) => n !== 'ioniq_charges')
    for (const name of names) assert.ok(known.has(name) || /^[A-Z]/.test(name), `${panel}: ${name}`)
  }
})

test('every query takes the filters and the time range, as one table frame', () => {
  for (const { panel, query, format } of queries) {
    assert.match(query, /"place" =~ \/\^\$place\$\/ AND "type" =~ \/\^\$type\$\/ AND \$timeFilter/, panel)
    // a table frame gives real columns, not one series per field
    assert.equal(format, 'table', panel)
  }
  assert.deepEqual(dashboard.templating.list.map((v) => v.name), ['place', 'type'])
})

test('the dashboard reads no location', () => {
  assert.doesNotMatch(JSON.stringify(dashboard), /\b(lat|lon|latitude|longitude|gps|address|station)\b/i)
})
