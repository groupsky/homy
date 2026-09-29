// Runs mongoScript through real mongosh against a throwaway MongoDB, the image
// routy runs (docker/mongo/Dockerfile's base), and compares the output with
// NDJSON written from the same readings. It checks what the unit tests can
// only assume: the `_id` and `_tz` selection and what mongosh prints for
// dates, NaN, Infinity and undefined. Needs docker; skipped without it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareDay, mongoScript } from './lib.mjs'

const IMAGE = readFileSync(new URL('../../docker/mongo/Dockerfile', import.meta.url), 'utf8').match(/^FROM\s+(\S+)/m)[1]
const DAY = '2026-01-15'
const START = Date.UTC(2026, 0, 15)
const END = START + 86400000
const HOUR = 3600000
const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0

// Readings built by the same source in Node (for the NDJSON line, as
// JSON.stringify writes it) and in mongosh (for the stored document).
const MAKE = `(tz, device) => ({
  voltage: 230.1, nan: NaN, inf: Infinity, missing: undefined, when: new Date(tz),
  big: 2 ** 40, list: [1, undefined, NaN], nested: { a: 1.5, b: 'ž' },
  _tz: tz, _ms: 12, _addr: 1, _type: 'sdm120', device
})`
// eslint-disable-next-line no-new-func
const make = new Function(`return ${MAKE}`)()

// [ _tz, seconds of the _id, in NDJSON of DAY ]
const FLAT = [
  [START + 1000, (START + 1000) / 1000, true],
  [START + 5, (START - 59000) / 1000, true], // _id inside the 60 s margin
  [END - 1, (END + 59000) / 1000, true],
  [END - 2, (END + 61000) / 1000, false], // _id outside the margin: not selected
  [START - 1, START / 1000 + 1, false] // _tz of the day before: not selected
]
// ioniq: a producer's _tz, arriving (_id) up to 36 h later
const WRAPPED = [
  [START + 1000, (START + 1000) / 1000 + 3, true],
  [END - 1000, (END + 30 * HOUR) / 1000, true],
  [END - 3000, (END + 37 * HOUR) / 1000, false]
]

// An ObjectId made at `seconds`, unique by `n` (the other 8 bytes)
const idAt = (seconds, n) => seconds.toString(16).padStart(8, '0') + n.toString(16).padStart(16, '0')

function mongosh (container, script) {
  return execFileSync('docker', ['exec', container, 'mongosh', '--quiet', '--norc', '-u', 'root', '-p', 'pw',
    '--authenticationDatabase', 'admin', 'power', '--eval', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

test('mongoScript run by real mongosh selects the day and matches the NDJSON', { skip: !hasDocker && 'needs docker', timeout: 180000 }, async (t) => {
  const container = `ndjson-overlap-test-${process.pid}`
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-e', 'MONGO_INITDB_ROOT_USERNAME=root',
    '-e', 'MONGO_INITDB_ROOT_PASSWORD=pw', IMAGE], { stdio: 'ignore' })
  t.after(() => spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' }))
  const raw = mkdtempSync(join(tmpdir(), 'ndjson-overlap-mongo-'))
  t.after(() => rmSync(raw, { recursive: true, force: true }))

  for (let i = 0; ; i++) {
    try {
      if (mongosh(container, 'db.adminCommand({ ping: 1 }).ok').trim() === '1') break
    } catch (err) {
      if (i > 90) throw err
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  mongosh(container, `const make = ${MAKE};
    for (const [tz, seconds, , id] of ${JSON.stringify(FLAT.map((r, n) => [...r, idAt(r[1], n)]))}) {
      db.main.insertOne({ _id: ObjectId(id), ...make(tz, 'meter') })
    }
    for (const [tz, seconds, , id] of ${JSON.stringify(WRAPPED.map((r, n) => [...r, idAt(r[1], n)]))}) {
      const arrived = new Date(seconds * 1000)
      db.ioniq.insertOne({ _id: ObjectId(id), topic: 'ioniq/soc', payload: { v: tz % 97, _tz: tz, _ts: arrived } })
    }`)

  mkdirSync(join(raw, 'main'))
  mkdirSync(join(raw, 'ioniq'))
  writeFileSync(join(raw, 'main', `${DAY}.main-power.ndjson`),
    FLAT.filter(([, , inDay]) => inDay).map(([tz]) => JSON.stringify(make(tz, 'meter')) + '\n').join(''))
  // The producer stamped _tz; each service adds its own _ts on arrival,
  // mqtt-ndjson's a few ms after mqtt-mongo's
  writeFileSync(join(raw, 'ioniq', `${DAY}.mqtt-ndjson-ioniq.ndjson`),
    WRAPPED.filter(([, , inDay]) => inDay).map(([tz, seconds]) => {
      const arrived = new Date(seconds * 1000 + 3)
      return JSON.stringify({ topic: 'ioniq/soc', payload: { v: tz % 97, _tz: tz, _ts: arrived.toISOString() } }) + '\n'
    }).join(''))

  const check = async (stream, shape, service) => {
    const output = mongosh(container, mongoScript({ stream, day: DAY, shape }))
    async function * lines () { yield output }
    return compareDay({ job: { stream, day: DAY, shape, rawDir: raw, services: [service] }, mongoLines: lines(), now: new Date(END + 40 * HOUR) })
  }

  const main = await check('main', 'flat', 'main-power')
  assert.deepEqual([main.mongo, main.ndjson, main.matched, main.equal], [3, 3, 3, true], JSON.stringify(main.samples))

  // A message filed by the producer's _tz but arriving 30 h later is still
  // selected; one arriving 37 h later is not (mqtt-ndjson files that one by
  // its arrival time, see docker/mqtt-ndjson/sink.js).
  const ioniq = await check('ioniq', 'wrapped', 'mqtt-ndjson-ioniq')
  assert.deepEqual([ioniq.mongo, ioniq.ndjson, ioniq.matched, ioniq.equal], [2, 2, 2, true], JSON.stringify(ioniq.samples))
})
