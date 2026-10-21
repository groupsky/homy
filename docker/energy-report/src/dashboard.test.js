import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The Grafana dashboard "Energy by month" reads what this service writes.
const dashboard = JSON.parse(readFileSync(new URL('../../../config/grafana/dashboards/energy-monthly.json', import.meta.url), 'utf8'))
const queries = dashboard.panels.flatMap((p) => (p.targets ?? []).map((t) => ({ panel: p.title, query: t.query })))
const selects = queries.filter(({ query }) => query.startsWith('SELECT'))

test('the month picker lists the months from the month tag, newest first', () => {
  const [month] = dashboard.templating.list
  assert.equal(month.name, 'month')
  assert.equal(month.query, 'SHOW TAG VALUES FROM "energy_monthly" WITH KEY = "month"')
  assert.equal(month.sort, 2)
})

test('no dashboard query depends on the dashboard time range', () => {
  assert.ok(selects.length > 0)
  for (const { panel, query } of [...queries, { panel: 'month', query: dashboard.templating.list[0].query }]) {
    assert.doesNotMatch(query, /\$timeFilter|\$__|now\(\)|\btime\s*[<>=]/, panel)
  }
})

test('every panel reads the month by its tag and takes the newest point of each series', () => {
  for (const { panel, query } of selects) {
    assert.match(query, /FROM "energy_monthly" WHERE "month" = '\$month'/, panel)
    assert.match(query, /ORDER BY time DESC LIMIT 1$/, panel)
    // The first field is one that every point has (kwh, kwh_day). A query of
    // only an optional field (cost, last year) would skip a newer point
    // without it and show an older one.
    assert.match(query, /^SELECT "(kwh|kwh_day)"/, panel)
  }
})
