import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  dayRange,
  defaultDay,
  objectIdAt,
  idRange,
  writersFromCompose,
  planJobs,
  mongoScript,
  fromRelaxedEjson,
  canonical,
  diffPaths,
  parseNdjson,
  compareDay,
  renderReport
} from './lib.mjs'

const DAY = '2026-09-30'
const START = Date.UTC(2026, 8, 30)
const END = Date.UTC(2026, 9, 1)

async function * chunks (...parts) {
  for (const part of parts) yield part
}

async function collect (iterable) {
  const out = []
  for await (const item of iterable) out.push(item)
  return out
}

// ---------------------------------------------------------------------------
// UTC day and ObjectId range

test('dayRange is the UTC day, start inclusive and end exclusive', () => {
  assert.deepEqual(dayRange(DAY), { start: START, end: END })
  assert.deepEqual(dayRange('2026-12-31'), { start: Date.UTC(2026, 11, 31), end: Date.UTC(2027, 0, 1) })
  assert.deepEqual(dayRange('2028-02-29'), { start: Date.UTC(2028, 1, 29), end: Date.UTC(2028, 2, 1) })
})

test('dayRange refuses anything that is not a real YYYY-MM-DD day', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-9-30', '30.09.2026', '2026-09-30T00:00:00Z', '', undefined]) {
    assert.throws(() => dayRange(bad), /YYYY-MM-DD/, String(bad))
  }
})

test('defaultDay is yesterday in UTC, whatever the local time', () => {
  assert.equal(defaultDay(new Date('2026-10-01T00:00:00.000Z')), DAY)
  assert.equal(defaultDay(new Date('2026-10-01T23:59:59.999Z')), DAY)
  assert.equal(defaultDay(new Date('2027-01-01T05:00:00.000Z')), '2026-12-31')
})

test('objectIdAt puts the whole seconds in the first 4 bytes, big-endian, rest zero', () => {
  assert.equal(objectIdAt(0), '000000000000000000000000')
  assert.equal(objectIdAt(1000), '000000010000000000000000')
  // 2026-09-30T00:00:00Z = 1790726400 s = 0x6abc5100
  assert.equal(objectIdAt(START), '6abc51000000000000000000')
  // Milliseconds are dropped (floor), so an id made in that second is >= it
  assert.equal(objectIdAt(START + 999), '6abc51000000000000000000')
  assert.throws(() => objectIdAt(-1000), /range/)
  assert.throws(() => objectIdAt(2 ** 32 * 1000), /range/)
})

test('idRange spans the day plus 60 s either side for modbus readings', () => {
  const { min, max } = idRange(DAY, 'flat')
  assert.equal(min, objectIdAt(START - 60000))
  assert.equal(max, objectIdAt(END + 60000))
  assert.equal(parseInt(min.slice(0, 8), 16), START / 1000 - 60)
  assert.equal(parseInt(max.slice(0, 8), 16), END / 1000 + 60)
})

test('idRange spans the day plus 36 h either side for {topic, payload} records', () => {
  // A producer's _tz picks the NDJSON file when it is within 36 h of arrival,
  // and mqtt-mongo's _id is the arrival time (docker/mqtt-ndjson/sink.js).
  const { min, max } = idRange(DAY, 'wrapped')
  assert.equal(parseInt(min.slice(0, 8), 16), START / 1000 - 36 * 3600)
  assert.equal(parseInt(max.slice(0, 8), 16), END / 1000 + 36 * 3600)
  assert.throws(() => idRange(DAY, 'other'), /record shape/)
})

// ---------------------------------------------------------------------------
// Writers from the compose config

// The shape of `docker compose config --format json`, trimmed to what matters.
const modbus = (name, collection, raw = '/srv/data/raw') => ({
  image: 'ghcr.io/groupsky/homy/modbus-serial:latest',
  environment: { COLLECTION: collection, SERVICE_NAME: name, RAW_DIR: '/data/raw', MONGODB_URL: 'mongodb://mongo/power' },
  volumes: [
    { type: 'bind', source: '/dev/serial', target: '/dev/serial' },
    { type: 'bind', source: raw, target: '/data/raw' }
  ]
})
const composeConfig = {
  services: {
    'main-power': modbus('main-power', 'main'),
    monitoring: modbus('monitoring', 'monitoring'),
    solar: modbus('solar', 'monitoring'),
    'mqtt-mongo-ioniq': {
      image: 'ghcr.io/groupsky/homy/mqtt-mongo:latest',
      environment: { COLLECTION: 'ioniq', TOPIC: 'ioniq/#' }
    },
    'mqtt-ndjson-ioniq': {
      image: 'ghcr.io/groupsky/homy/mqtt-ndjson@sha256:0123',
      environment: { STREAM: 'ioniq', SERVICE_NAME: 'mqtt-ndjson-ioniq', RAW_DIR: '/data/raw' },
      volumes: [{ type: 'bind', source: '/srv/data/raw', target: '/data/raw' }]
    },
    broker: { image: 'ghcr.io/groupsky/homy/mosquitto:latest', environment: {} }
  }
}

test('writersFromCompose groups the NDJSON writers by stream', () => {
  const writers = writersFromCompose(composeConfig)
  assert.deepEqual([...writers.keys()], ['ioniq', 'main', 'monitoring'])
  assert.deepEqual(writers.get('main'), { stream: 'main', shape: 'flat', rawDir: '/srv/data/raw', services: ['main-power'] })
  assert.deepEqual(writers.get('monitoring'), { stream: 'monitoring', shape: 'flat', rawDir: '/srv/data/raw', services: ['monitoring', 'solar'] })
  assert.deepEqual(writers.get('ioniq'), { stream: 'ioniq', shape: 'wrapped', rawDir: '/srv/data/raw', services: ['mqtt-ndjson-ioniq'] })
})

test('writersFromCompose refuses a config it cannot read unambiguously', () => {
  const withService = (name, service) => ({ services: { ...composeConfig.services, [name]: service } })
  assert.throws(() => writersFromCompose(withService('odd', { ...modbus('odd', 'main'), image: 'ghcr.io/groupsky/homy/other:1' })), /record shape/)
  assert.throws(() => writersFromCompose(withService('odd', { ...modbus('odd', 'main'), volumes: [] })), /not a bind mount/)
  assert.throws(() => writersFromCompose(withService('odd', modbus('odd', 'main', '/elsewhere'))), /different raw directories/)
  assert.throws(() => writersFromCompose(withService('odd', modbus('../odd', 'main'))), /plain name/)
})

test('planJobs makes one job per stream and day, with the Mongo query', () => {
  const jobs = planJobs(composeConfig, { streams: ['monitoring', 'ioniq'], days: [DAY, '2026-10-01'] })
  assert.deepEqual(jobs.map((j) => `${j.stream} ${j.day}`), [
    'ioniq 2026-09-30', 'ioniq 2026-10-01', 'monitoring 2026-09-30', 'monitoring 2026-10-01'
  ])
  assert.deepEqual(jobs[2].services, ['monitoring', 'solar'])
  assert.equal(jobs[2].mongoScript, mongoScript({ stream: 'monitoring', day: DAY, shape: 'flat' }))
  assert.equal(planJobs(composeConfig, { days: [DAY] }).length, 3)
  assert.throws(() => planJobs(composeConfig, { streams: ['nope'], days: [DAY] }), /no NDJSON writer.*nope.*ioniq, main, monitoring/)
  assert.throws(() => planJobs(composeConfig, { days: [] }), /day/)
})

// ---------------------------------------------------------------------------
// Mongo query

test('mongoScript selects the day by _id range and _tz, without _id', () => {
  const script = mongoScript({ stream: 'main', day: DAY, shape: 'flat' })
  const { min, max } = idRange(DAY, 'flat')
  assert.match(script, /db\.getCollection\("main"\)/)
  assert.ok(script.includes(`_id: { $gte: ObjectId("${min}"), $lt: ObjectId("${max}") }`), script)
  assert.ok(script.includes(`"_tz": { $gte: ${START}, $lt: ${END} }`), script)
  assert.ok(script.includes('{ _id: 0 }'), script)
  assert.match(script, /EJSON\.stringify\(/)
})

test('mongoScript uses payload._tz for {topic, payload} records', () => {
  const script = mongoScript({ stream: 'ioniq', day: DAY, shape: 'wrapped' })
  const { min, max } = idRange(DAY, 'wrapped')
  assert.ok(script.includes(`"payload._tz": { $gte: ${START}, $lt: ${END} }`), script)
  assert.ok(script.includes(`_id: { $gte: ObjectId("${min}"), $lt: ObjectId("${max}") }`), script)
})

test('mongoScript evaluates to undefined, so mongosh prints only the documents', () => {
  // A script whose last statement has a value makes mongosh print it too.
  const script = mongoScript({ stream: 'main', day: DAY, shape: 'flat' })
  const printed = []
  const docs = [{ a: 1 }, { b: 2 }]
  const cursor = { batchSize: () => cursor, hasNext: () => docs.length > 0, next: () => docs.shift() }
  const db = { getCollection: () => ({ find: () => cursor }) }
  // eslint-disable-next-line no-new-func
  const result = new Function('db', 'ObjectId', 'EJSON', 'print', `return eval(${JSON.stringify(script)})`)(
    db, (hex) => hex, { stringify: (d) => JSON.stringify(d) }, (s) => printed.push(s))
  assert.equal(result, undefined)
  assert.deepEqual(printed.join('\n').split('\n'), ['{"a":1}', '{"b":2}'])
})

// ---------------------------------------------------------------------------
// Record equality

test('fromRelaxedEjson turns relaxed Extended JSON into what JSON.stringify writes', () => {
  assert.deepEqual(fromRelaxedEjson({
    at: { $date: '2026-09-30T10:00:00Z' },
    atMs: { $date: '2026-09-30T10:00:00.123Z' },
    old: { $date: { $numberLong: '-1000' } },
    nan: { $numberDouble: 'NaN' },
    inf: { $numberDouble: 'Infinity' },
    negInf: { $numberDouble: '-Infinity' },
    negZero: { $numberDouble: '-0.0' },
    big: { $numberLong: '9007199254740993' },
    int: { $numberInt: '7' },
    id: { $oid: '6abc51000000000000000000' },
    list: [{ $numberDouble: 'NaN' }, 1.5, 'x'],
    nested: { v: { $date: '2026-09-30T00:00:00Z' } },
    plain: 12.25
  }), {
    at: '2026-09-30T10:00:00.000Z',
    atMs: '2026-09-30T10:00:00.123Z',
    old: '1969-12-31T23:59:59.000Z',
    nan: null,
    inf: null,
    negInf: null,
    negZero: 0,
    big: 9007199254740992,
    int: 7,
    id: '6abc51000000000000000000',
    list: [null, 1.5, 'x'],
    nested: { v: '2026-09-30T00:00:00.000Z' },
    plain: 12.25
  })
})

test('fromRelaxedEjson leaves an object that only looks like a wrapper alone', () => {
  const value = { $date: '2026-09-30T00:00:00Z', extra: 1 }
  assert.deepEqual(fromRelaxedEjson(value), value)
})

test('canonical ignores key order and null or undefined keys', () => {
  // BSON stores an undefined field as null; JSON leaves it out.
  assert.equal(canonical({ b: 1, a: { d: [1, null], c: 2 } }, 'flat'), canonical({ a: { c: 2, d: [1, null] }, b: 1, x: null }, 'flat'))
  assert.equal(canonical({ a: 1, u: undefined }, 'flat'), canonical({ a: 1 }, 'flat'))
  assert.notEqual(canonical({ a: 1 }, 'flat'), canonical({ a: 1.5 }, 'flat'))
  assert.notEqual(canonical({ a: [1, 2] }, 'flat'), canonical({ a: [2, 1] }, 'flat'))
  assert.notEqual(canonical({ a: '1' }, 'flat'), canonical({ a: 1 }, 'flat'))
})

test('canonical compares a flat record in full, _tz included', () => {
  assert.notEqual(canonical({ device: 'm', _tz: 1 }, 'flat'), canonical({ device: 'm', _tz: 2 }, 'flat'))
})

test('canonical ignores payload._tz and payload._ts of a {topic, payload} record', () => {
  // mqtt-mongo and mqtt-ndjson each stamp the arrival time themselves.
  const mongo = { topic: 'ioniq/soc', payload: { v: 80, _tz: 1000, _ts: '1970-01-01T00:00:01.000Z' } }
  const ndjson = { topic: 'ioniq/soc', payload: { v: 80, _tz: 1003, _ts: '1970-01-01T00:00:01.003Z' } }
  assert.equal(canonical(mongo, 'wrapped'), canonical(ndjson, 'wrapped'))
  assert.notEqual(canonical(mongo, 'wrapped'), canonical({ ...ndjson, topic: 'ioniq/speed' }, 'wrapped'))
  assert.notEqual(canonical(mongo, 'wrapped'), canonical({ ...ndjson, payload: { ...ndjson.payload, v: 81 } }, 'wrapped'))
})

test('diffPaths names the fields that differ', () => {
  assert.deepEqual(diffPaths({ a: 1, b: { c: 2, d: 3 }, e: [1] }, { a: 1, b: { c: 2, d: 4 }, e: [1, 2], f: 0 }), ['b.d', 'e', 'f'])
  assert.deepEqual(diffPaths({ a: 1, n: null }, { a: 1 }), [])
  assert.deepEqual(diffPaths({ a: 1 }, { a: 1 }), [])
})

// ---------------------------------------------------------------------------
// Reading NDJSON

test('parseNdjson yields records across chunk boundaries', async () => {
  const out = await collect(parseNdjson(chunks('{"a":1}\n{"a"', ':2}\n', '\n{"a":3}\n')))
  assert.deepEqual(out, [
    { kind: 'record', record: { a: 1 } },
    { kind: 'record', record: { a: 2 } },
    { kind: 'record', record: { a: 3 } }
  ])
})

test('parseNdjson reports a last line cut by a crash separately from a bad line', async () => {
  // The writer repairs a cut line on reopen with a '\n', so a cut line
  // inside the file is terminated; one at the very end is not.
  const out = await collect(parseNdjson(chunks('{"a":1}\n{"a":2,"b\n{"a":3}\n{"a":4,"x":')))
  assert.deepEqual(out, [
    { kind: 'record', record: { a: 1 } },
    { kind: 'bad', text: '{"a":2,"b' },
    { kind: 'record', record: { a: 3 } },
    { kind: 'cut', text: '{"a":4,"x":' }
  ])
})

test('parseNdjson takes a complete last line without a newline as a record', async () => {
  const out = await collect(parseNdjson(chunks('{"a":1}\n{"a":2}')))
  assert.deepEqual(out.map((o) => o.kind), ['record', 'record'])
})

test('parseNdjson counts a line that is JSON but not an object as bad', async () => {
  const out = await collect(parseNdjson(chunks('1\n[1]\nnull\n')))
  assert.deepEqual(out.map((o) => o.kind), ['bad', 'bad', 'bad'])
})

// ---------------------------------------------------------------------------
// Comparing one stream and day

function rawDir (files) {
  const dir = mkdtempSync(join(tmpdir(), 'ndjson-overlap-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const reading = (device, tz, extra = {}) => ({ _tz: tz, _ms: 12, _addr: 1, _type: 'sdm120', device, power: 100.5, ...extra })
const ndjsonOf = (...records) => records.map((r) => JSON.stringify(r) + '\n').join('')
// What mongosh prints: relaxed EJSON with an insertion order of its own.
const ejsonOf = (record) => JSON.stringify(Object.fromEntries(Object.entries(record).reverse())) + '\n'

const flatJob = (dir, services) => ({ stream: 'monitoring', day: DAY, shape: 'flat', rawDir: dir, services })
const after = new Date(END + 3600000)

test('compareDay: the NDJSON files of all writers together equal Mongo', async (t) => {
  const a = reading('pump', START + 1000)
  const b = reading('heater', START + 2000)
  const c = reading('solar', END - 1)
  const dir = rawDir({
    [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(a, b),
    [`monitoring/${DAY}.solar.ndjson`]: ndjsonOf(c)
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring', 'solar']), mongoLines: chunks(ejsonOf(c), ejsonOf(a), ejsonOf(b)), now: after })

  assert.equal(result.mongo, 3)
  assert.equal(result.ndjson, 3)
  assert.equal(result.matched, 3)
  assert.equal(result.onlyMongo, 0)
  assert.equal(result.onlyNdjson, 0)
  assert.equal(result.equal, true)
  assert.deepEqual(result.files.map((f) => [f.service, f.records, f.paths.length]), [['monitoring', 2, 1], ['solar', 1, 1]])
  assert.deepEqual(result.notes, [])
})

test('compareDay: equal counts with different content is not equal', async (t) => {
  const a = reading('pump', START + 1000)
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(a) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(ejsonOf({ ...a, power: 99 })), now: after })

  assert.equal(result.mongo, 1)
  assert.equal(result.ndjson, 1)
  assert.equal(result.matched, 0)
  assert.equal(result.onlyMongo, 1)
  assert.equal(result.onlyNdjson, 1)
  assert.equal(result.equal, false)
  assert.deepEqual(result.differences, [{ id: 'pump@' + (START + 1000), fields: ['power'] }])
  assert.deepEqual(result.samples.onlyMongo, [{ ...a, power: 99 }])
  assert.deepEqual(result.samples.onlyNdjson, [a])
})

test('compareDay: duplicates count as many times as they appear', async (t) => {
  const a = reading('pump', START + 1000)
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(a, a) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(ejsonOf(a)), now: after })

  assert.equal(result.matched, 1)
  assert.equal(result.onlyNdjson, 1)
  assert.equal(result.onlyMongo, 0)
  assert.equal(result.equal, false)
  assert.deepEqual(result.samples.onlyNdjson, [a])
})

test('compareDay: a cut last line is skipped and noted, not counted', async (t) => {
  const a = reading('pump', START + 1000)
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(a) + '{"_tz":1,"dev' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(ejsonOf(a)), now: after })

  assert.equal(result.ndjson, 1)
  assert.equal(result.equal, true)
  assert.deepEqual(result.files[0].cut, 1)
  assert.deepEqual(result.notes, ['monitoring: last line cut short (skipped)'])
})

test('compareDay: a bad line inside a file is noted and not counted', async (t) => {
  const a = reading('pump', START + 1000)
  const b = reading('pump', START + 2000)
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(a) + '{"cut\n' + ndjsonOf(b) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(ejsonOf(a), ejsonOf(b), ejsonOf(reading('pump', START + 1500))), now: after })

  assert.equal(result.ndjson, 2)
  assert.equal(result.onlyMongo, 1)
  assert.deepEqual(result.notes, ['monitoring: 1 unreadable line(s)'])
})

test('compareDay: a missing file counts as no records and is noted', async (t) => {
  const dir = rawDir({})
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring', 'solar']), mongoLines: chunks(), now: after })

  assert.equal(result.mongo, 0)
  assert.equal(result.ndjson, 0)
  assert.equal(result.equal, true)
  assert.deepEqual(result.notes, ['monitoring: no file', 'solar: no file'])
})

test('compareDay reads a day the archive job already gzipped', async (t) => {
  const a = reading('pump', START + 1000)
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson.gz`]: gzipSync(ndjsonOf(a)) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(ejsonOf(a)), now: after })

  assert.equal(result.equal, true)
  assert.match(result.files[0].paths[0], /\.ndjson\.gz$/)
})

test('compareDay reads a late plain file next to the gzipped day', async (t) => {
  const a = reading('pump', START + 1000)
  const b = reading('pump', START + 2000)
  const dir = rawDir({
    [`monitoring/${DAY}.monitoring.ndjson.gz`]: gzipSync(ndjsonOf(a)),
    [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(b)
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(ejsonOf(a), ejsonOf(b)), now: after })

  assert.equal(result.ndjson, 2)
  assert.equal(result.equal, true)
  assert.deepEqual(result.notes, ['monitoring: both .ndjson and .ndjson.gz (both read)'])
})

test('compareDay rejects a broken gzip file instead of crashing', async (t) => {
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson.gz`]: 'not gzip' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  await assert.rejects(compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(), now: after }), /header/)
})

test('compareDay notes NDJSON records whose _tz is outside the day', async (t) => {
  const a = reading('pump', START - 1)
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(a) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(), now: after })

  assert.equal(result.files[0].outsideDay, 1)
  assert.deepEqual(result.notes, ['monitoring: 1 record(s) with _tz outside the day'])
})

test('compareDay notes a day that is not over yet, margin included', async (t) => {
  const dir = rawDir({})
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const NOTE = 'day not over yet: counts will still change'
  const ioniq = { stream: 'ioniq', day: DAY, shape: 'wrapped', rawDir: dir, services: ['mqtt-ndjson-ioniq'] }

  const check = async (job, now) => (await compareDay({ job, mongoLines: chunks(), now: new Date(now) })).notes.includes(NOTE)

  assert.equal(await check(flatJob(dir, ['monitoring']), END + 59000), true)
  assert.equal(await check(flatJob(dir, ['monitoring']), END + 60000), false)
  assert.equal(await check(ioniq, END + 35 * 3600000), true)
  assert.equal(await check(ioniq, END + 36 * 3600000), false)
})

test('compareDay matches {topic, payload} records despite their own arrival stamps', async (t) => {
  const line = { topic: 'ioniq/soc', payload: { v: 80, _tz: START + 5003, _ts: new Date(START + 5003).toISOString() } }
  const doc = { topic: 'ioniq/soc', payload: { v: 80, _tz: START + 5000, _ts: { $date: new Date(START + 5000).toISOString() } } }
  const dir = rawDir({ [`ioniq/${DAY}.mqtt-ndjson-ioniq.ndjson`]: ndjsonOf(line) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({
    job: { stream: 'ioniq', day: DAY, shape: 'wrapped', rawDir: dir, services: ['mqtt-ndjson-ioniq'] },
    mongoLines: chunks(JSON.stringify(doc)),
    now: new Date(END + 36 * 3600000)
  })

  assert.equal(result.equal, true)
  assert.deepEqual(result.notes, [])
})

test('compareDay refuses Mongo output that is not a document per line', async (t) => {
  const dir = rawDir({})
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  await assert.rejects(
    compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks('MongoServerError: auth failed'), now: after }),
    /Mongo output line 1 is not a document/
  )
})

test('compareDay keeps only a bounded number of sample records', async (t) => {
  const records = Array.from({ length: 10 }, (_, i) => reading('pump', START + i))
  const dir = rawDir({ [`monitoring/${DAY}.monitoring.ndjson`]: ndjsonOf(...records) })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const result = await compareDay({ job: flatJob(dir, ['monitoring']), mongoLines: chunks(), now: after, sampleLimit: 3 })

  assert.equal(result.onlyNdjson, 10)
  assert.equal(result.samples.onlyNdjson.length, 3)
})

// ---------------------------------------------------------------------------
// Report

const row = (over) => ({
  stream: 'main',
  day: DAY,
  services: ['main-power'],
  files: [{ service: 'main-power', records: 5 }],
  sampleLimit: 20,
  mongo: 5,
  ndjson: 5,
  matched: 5,
  onlyMongo: 0,
  onlyNdjson: 0,
  equal: true,
  notes: [],
  differences: [],
  samples: { onlyMongo: [], onlyNdjson: [] },
  ...over
})

test('renderReport prints a markdown table sorted by stream then day', () => {
  const { markdown, allEqual } = renderReport([
    row({ day: '2026-10-01' }),
    row({ stream: 'dry-switches', services: ['dry-switches'], files: [{ service: 'dry-switches', records: 5 }] }),
    row({})
  ])
  assert.equal(allEqual, true)
  assert.equal(markdown, [
    '| stream | UTC day | Mongo | NDJSON | equal | notes |',
    '|---|---|---:|---:|---|---|',
    '| dry-switches | 2026-09-30 | 5 | 5 | yes |  |',
    '| main | 2026-09-30 | 5 | 5 | yes |  |',
    '| main | 2026-10-01 | 5 | 5 | yes |  |',
    ''
  ].join('\n'))
})

test('renderReport shows each writer of a shared stream and what differs', () => {
  const { markdown, allEqual } = renderReport([row({
    stream: 'monitoring',
    services: ['monitoring', 'solar'],
    files: [{ service: 'monitoring', records: 3 }, { service: 'solar', records: 2 }],
    mongo: 6,
    ndjson: 5,
    matched: 4,
    onlyMongo: 2,
    onlyNdjson: 1,
    equal: false,
    notes: ['solar: last line cut short (skipped)'],
    differences: [{ id: 'pump@1', fields: ['power'] }]
  })])
  assert.equal(allEqual, false)
  const lines = markdown.split('\n')
  assert.equal(lines[2], '| monitoring | 2026-09-30 | 6 | 5 | **no**: 2 only in Mongo, 1 only in NDJSON | monitoring 3 + solar 2; solar: last line cut short (skipped) |')
  assert.ok(lines.includes('- monitoring 2026-09-30: among the first 20 differing records of each side, 1 pair(s) by device and _tz differ in: power'), markdown)
})

test('renderReport keeps the last result of a stream and day that was checked twice', () => {
  const { markdown, allEqual } = renderReport([row({ equal: false, onlyMongo: 1, mongo: 6 }), row({})])
  assert.equal(allEqual, true)
  assert.equal(markdown.split('\n').filter((l) => l.startsWith('| main')).length, 1)
})

test('renderReport never prints the readings themselves', () => {
  // The table goes into a public issue; samples stay on the host.
  const { markdown } = renderReport([row({ equal: false, onlyMongo: 1, samples: { onlyMongo: [{ secret: 'lat 42.1' }], onlyNdjson: [] } })])
  assert.doesNotMatch(markdown, /lat 42\.1/)
})

test('renderReport can include the samples for a local look', () => {
  const { markdown } = renderReport([row({ equal: false, onlyMongo: 1, samples: { onlyMongo: [{ v: 'x1' }], onlyNdjson: [{ v: 'y2' }] } })], { samples: true })
  assert.match(markdown, /only in Mongo[\s\S]*"v":"x1"[\s\S]*only in NDJSON[\s\S]*"v":"y2"/)
})
