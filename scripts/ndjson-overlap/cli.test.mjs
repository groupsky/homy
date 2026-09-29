// Runs index.mjs as scripts/ndjson-overlap.sh does, on real files, with the
// Mongo output given on stdin instead of from docker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const INDEX = fileURLToPath(new URL('./index.mjs', import.meta.url))
const DAY = '2026-09-30'
const START = Date.UTC(2026, 8, 30)

function run (args, input) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [INDEX, ...args], { input, encoding: 'utf8' })
  return { status, stdout, stderr }
}

function setup (t) {
  const dir = mkdtempSync(join(tmpdir(), 'ndjson-overlap-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const compose = {
    services: {
      'main-power': {
        image: 'ghcr.io/groupsky/homy/modbus-serial:latest',
        environment: { COLLECTION: 'main', SERVICE_NAME: 'main-power', RAW_DIR: '/data/raw' },
        volumes: [{ type: 'bind', source: dir, target: '/data/raw' }]
      }
    }
  }
  return { dir, compose: JSON.stringify(compose) }
}

const reading = (tz, power) => ({ _tz: tz, _ms: 10, _addr: 2, _type: 'sdm630', device: 'main', power })

test('plan, compare and report: an equal day exits 0', (t) => {
  const { dir, compose } = setup(t)
  const records = [reading(START + 1, 1), reading(START + 2, 2)]
  mkdirSync(join(dir, 'main'))
  writeFileSync(join(dir, 'main', `${DAY}.main-power.ndjson`), records.map((r) => JSON.stringify(r) + '\n').join(''))

  const plan = run(['plan', '--stream', 'main', DAY], compose)
  assert.equal(plan.status, 0, plan.stderr)
  const jobs = plan.stdout.trim().split('\n')
  assert.equal(jobs.length, 1)
  assert.match(JSON.parse(jobs[0]).mongoScript, /getCollection\("main"\)/)

  const compare = run(['compare', jobs[0]], records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  assert.equal(compare.status, 0, compare.stderr)
  assert.equal(JSON.parse(compare.stdout).equal, true)

  const report = run(['report'], compare.stdout)
  assert.equal(report.status, 0, report.stderr)
  assert.match(report.stdout, /\| main \| 2026-09-30 \| 2 \| 2 \| yes \|/)
})

test('report exits 1 when a day differs', (t) => {
  const { dir, compose } = setup(t)
  const job = run(['plan', DAY], compose).stdout.trim()
  mkdirSync(join(dir, 'main'))
  writeFileSync(join(dir, 'main', `${DAY}.main-power.ndjson`), JSON.stringify(reading(START + 1, 1)) + '\n')

  const compare = run(['compare', job], JSON.stringify(reading(START + 1, 1.5)) + '\n')
  const report = run(['report'], compare.stdout)

  assert.equal(report.status, 1)
  assert.match(report.stdout, /\*\*no\*\*: 1 only in Mongo, 1 only in NDJSON/)
  assert.match(report.stdout, /1 pair\(s\) by device and _tz differ in: power/)
})

test('plan without a day checks yesterday (UTC)', (t) => {
  const { compose } = setup(t)
  const plan = run(['plan'], compose)
  assert.equal(plan.status, 0, plan.stderr)
  assert.equal(JSON.parse(plan.stdout).day, new Date(Date.now() - 86400000).toISOString().slice(0, 10))
})

test('a failed check exits 2 with the reason', (t) => {
  const { compose } = setup(t)
  const bad = run(['plan', '2026-02-30'], compose)
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /ndjson-overlap: not a UTC day/)

  const job = run(['plan', DAY], compose).stdout.trim()
  const mongoError = run(['compare', job], 'MongoServerError: Authentication failed.\n')
  assert.equal(mongoError.status, 2)
  assert.match(mongoError.stderr, /not a document/)

  assert.equal(run(['nope'], '').status, 2)
})
