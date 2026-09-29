// Compares the daily NDJSON files with MongoDB for one stream and UTC day
// (issue #1622, phase 2). While both run, every reading goes to both, so the
// NDJSON lines of a day must equal the Mongo documents whose `_tz` is in that
// day. The pure parts live here; index.mjs does the I/O around them and
// ../ndjson-overlap.sh runs the Mongo query. See README.md.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createGunzip } from 'node:zlib'

const DAY_MS = 24 * 60 * 60 * 1000

// How far outside the day a Mongo `_id` may be made, by record shape.
// - flat: modbus-serial creates the `_id` within milliseconds of `_tz`; the
//   margin is issue #1622's "± 60 s".
// - wrapped: mqtt-mongo keeps a `payload._tz` the producer stamped, while the
//   `_id` is the arrival time, and mqtt-ndjson files such a line by that `_tz`
//   when it is within 36 hours of the arrival (MAX_PRODUCER_SKEW_MS in
//   docker/mqtt-ndjson/sink.js). A retained or redelivered message can arrive
//   that late, so the margin is the same 36 hours.
export const ID_MARGIN_MS = { flat: 60 * 1000, wrapped: 36 * 60 * 60 * 1000 }

// Records kept per direction to show what differs.
export const SAMPLE_LIMIT = 20

// A stream or service name is one path segment, as in day-file-writer.js.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

// The record each writer image produces:
// - flat: modbus-serial's reading, `{ _tz, _ms, _addr, _type, device, ... }`,
//   the same object its mongodb integration inserts.
// - wrapped: `{ topic, payload }` with `payload._tz`, from mqtt-ndjson; the
//   Mongo side is mqtt-mongo.
const SHAPES = new Map([
  ['modbus-serial', 'flat'],
  ['mqtt-ndjson', 'wrapped']
])

/** `{ start, end }` in epoch ms of a UTC day 'YYYY-MM-DD', end exclusive. */
export function dayRange (day) {
  const match = typeof day === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const start = match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : NaN
  if (!match || new Date(start).toISOString().slice(0, 10) !== day) {
    throw new Error(`not a UTC day in the form YYYY-MM-DD: ${JSON.stringify(day)}`)
  }
  return { start, end: start + DAY_MS }
}

/** The last finished UTC day before `now`. */
export function defaultDay (now = new Date()) {
  return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10)
}

/**
 * The smallest ObjectId made in the second of `epochMs`: its first 4 bytes are
 * the Unix time in seconds, big-endian, and the other 8 are zero.
 */
export function objectIdAt (epochMs) {
  const seconds = Math.floor(epochMs / 1000)
  if (!(seconds >= 0 && seconds < 2 ** 32)) {
    throw new Error(`time out of the ObjectId range: ${epochMs}`)
  }
  return seconds.toString(16).padStart(8, '0') + '0'.repeat(16)
}

function idMargin (shape) {
  const margin = ID_MARGIN_MS[shape]
  if (margin === undefined) throw new Error(`unknown record shape ${JSON.stringify(shape)}`)
  return margin
}

/** ObjectId bounds `[min, max)` of the day plus the shape's margin either side. */
export function idRange (day, shape) {
  const { start, end } = dayRange(day)
  const margin = idMargin(shape)
  return { min: objectIdAt(start - margin), max: objectIdAt(end + margin) }
}

function imageName (image) {
  const name = String(image ?? '').replace(/@.*$/, '').split('/').pop()
  return name.replace(/:.*$/, '')
}

function requireSegment (value, what, service) {
  if (typeof value !== 'string' || !SEGMENT.test(value)) {
    throw new Error(`${service}: ${what} must be a plain name, got ${JSON.stringify(value)}`)
  }
}

/**
 * The NDJSON writers of `docker compose config --format json`, by stream:
 * every service with a RAW_DIR. Its stream is STREAM (mqtt-ndjson) or
 * COLLECTION (modbus-serial), its file name part SERVICE_NAME, and the host
 * directory the bind mount at RAW_DIR. Compose has already resolved .env, so
 * `RAW_DATA_PATH=${DATA_PATH}/raw` arrives as the real host path.
 *
 * @returns {Map<string, {stream, shape, rawDir, services: string[]}>} sorted by stream
 */
export function writersFromCompose (config) {
  const streams = new Map()
  for (const [name, service] of Object.entries(config?.services ?? {})) {
    const env = service.environment ?? {}
    if (!env.RAW_DIR) continue
    const stream = env.STREAM ?? env.COLLECTION
    const file = env.SERVICE_NAME
    requireSegment(stream, 'STREAM or COLLECTION', name)
    requireSegment(file, 'SERVICE_NAME', name)
    const shape = SHAPES.get(imageName(service.image))
    if (!shape) {
      throw new Error(`${name}: the record shape of image ${service.image} is not known (expected ${[...SHAPES.keys()].join(' or ')})`)
    }
    const mount = (service.volumes ?? []).find((v) => v.target === env.RAW_DIR && v.type === 'bind')
    if (!mount?.source) {
      throw new Error(`${name}: RAW_DIR ${env.RAW_DIR} is not a bind mount`)
    }
    const writers = streams.get(stream)
    if (!writers) {
      streams.set(stream, { stream, shape, rawDir: mount.source, services: [file] })
    } else if (writers.shape !== shape || writers.rawDir !== mount.source) {
      throw new Error(`stream ${stream}: writers with different raw directories or record shapes (${writers.services.join(', ')}, ${file})`)
    } else {
      writers.services.push(file)
    }
  }
  for (const writers of streams.values()) writers.services.sort()
  return new Map([...streams].sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * One job per stream and day: everything `compare` needs, and the mongosh
 * script that exports the day's Mongo documents.
 */
export function planJobs (config, { streams = [], days }) {
  if (!days?.length) throw new Error('no day to check')
  const writers = writersFromCompose(config)
  const chosen = streams.length ? [...new Set(streams)].sort() : [...writers.keys()]
  const jobs = []
  for (const stream of chosen) {
    const w = writers.get(stream)
    if (!w) {
      throw new Error(`no NDJSON writer for stream ${JSON.stringify(stream)}; there are: ${[...writers.keys()].join(', ')}`)
    }
    for (const day of [...new Set(days)].sort()) {
      jobs.push({ ...w, day, mongoScript: mongoScript({ stream, day, shape: w.shape }) })
    }
  }
  return jobs
}

/**
 * mongosh script printing, one per line as relaxed Extended JSON and without
 * `_id`, the documents of `stream` inside the day's `_id` range whose `_tz`
 * is in the day. The `_id` range lets the query use the `_id` index; `_tz`
 * picks the day as the writer picks the file. The script evaluates to
 * undefined, so mongosh prints nothing else.
 */
export function mongoScript ({ stream, day, shape }) {
  const { start, end } = dayRange(day)
  const { min, max } = idRange(day, shape)
  const tz = shape === 'wrapped' ? 'payload._tz' : '_tz'
  return `(function () {
  const cursor = db.getCollection(${JSON.stringify(stream)}).find(
    { _id: { $gte: ObjectId("${min}"), $lt: ObjectId("${max}") }, ${JSON.stringify(tz)}: { $gte: ${start}, $lt: ${end} } },
    { _id: 0 }
  ).batchSize(5000);
  let lines = [];
  while (cursor.hasNext()) {
    lines.push(EJSON.stringify(cursor.next(), { relaxed: true }));
    if (lines.length === 1000) { print(lines.join("\\n")); lines = []; }
  }
  if (lines.length > 0) print(lines.join("\\n"));
})();
`
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKey (value, key) {
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === key
}

/**
 * Turns relaxed Extended JSON, as mongosh prints it, into the value
 * JSON.stringify gives for the same object in the writer: a date becomes its
 * ISO string (mongosh drops `.000`), NaN and ±Infinity become null, -0 becomes
 * 0, and 64-bit integers become numbers. Anything else is left alone.
 */
export function fromRelaxedEjson (value) {
  if (Array.isArray(value)) return value.map(fromRelaxedEjson)
  if (!isPlainObject(value)) return value
  if (onlyKey(value, '$date')) {
    const raw = value.$date
    const ms = isPlainObject(raw) && onlyKey(raw, '$numberLong') ? Number(raw.$numberLong) : Date.parse(raw)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value
  }
  if (onlyKey(value, '$numberDouble')) {
    const n = Number(value.$numberDouble)
    return Number.isFinite(n) ? n + 0 : null
  }
  if (onlyKey(value, '$numberInt') || onlyKey(value, '$numberLong')) {
    return Number(Object.values(value)[0])
  }
  if (onlyKey(value, '$oid')) return value.$oid
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromRelaxedEjson(v)]))
}

// Sorted keys; object keys whose value is null or undefined dropped: BSON
// stores an undefined field as null, JSON leaves it out.
function normalize (value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)))
  if (!isPlainObject(value)) return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== null && value[key] !== undefined) out[key] = normalize(value[key])
  }
  return out
}

// A {topic, payload} record without the arrival stamps: mqtt-mongo and
// mqtt-ndjson each receive the message and stamp `_tz`/`_ts` themselves, a few
// milliseconds apart. Everything else must still be equal.
function comparable (record, shape) {
  if (shape !== 'wrapped' || !isPlainObject(record.payload)) return record
  const { _tz, _ts, ...payload } = record.payload
  return { ...record, payload }
}

/** The text two records are equal by. See normalize and comparable. */
export function canonical (record, shape) {
  return JSON.stringify(normalize(comparable(record, shape)))
}

/** Dotted paths of the fields that differ between two records (after normalize). */
export function diffPaths (a, b) {
  const paths = []
  const walk = (x, y, prefix) => {
    if (isPlainObject(x) && isPlainObject(y)) {
      for (const key of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
        walk(x[key], y[key], prefix ? `${prefix}.${key}` : key)
      }
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      paths.push(prefix)
    }
  }
  walk(normalize(a), normalize(b), '')
  return paths
}

/**
 * Parses NDJSON text chunks into
 * - `{ kind: 'record', record }` for each line that is a JSON object,
 * - `{ kind: 'cut', text }` for a last line without '\n' that is not JSON: a
 *   write cut short when the day ended (day-file-writer.js only repairs a file
 *   when it reopens it), not a reading,
 * - `{ kind: 'bad', text }` for any other line that is not a JSON object.
 * Empty lines are skipped.
 */
export async function * parseNdjson (chunks) {
  const parse = (text) => {
    try {
      const value = JSON.parse(text)
      return isPlainObject(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  let rest = ''
  for await (const chunk of chunks) {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    for (const text of lines) {
      if (text === '') continue
      const record = parse(text)
      yield record ? { kind: 'record', record } : { kind: 'bad', text }
    }
  }
  if (rest !== '') {
    const record = parse(rest)
    yield record ? { kind: 'record', record } : { kind: 'cut', text: rest }
  }
}

/**
 * The NDJSON files of a writer and day: the one the archive job gzipped, and
 * the plain one. Both can exist: mqtt-ndjson can still append a late line
 * after the day was gzipped, and that recreates the plain file.
 */
function dayFiles (rawDir, stream, day, service) {
  const plain = join(rawDir, stream, `${day}.${service}.ndjson`)
  return [{ path: `${plain}.gz`, gzip: true }, { path: plain, gzip: false }].filter((f) => existsSync(f.path))
}

// Text chunks of a file. A read error of a gzipped file is passed on to the
// reader, so it rejects instead of crashing the process.
function readText ({ path, gzip }) {
  const file = createReadStream(path)
  if (!gzip) {
    file.setEncoding('utf8')
    return file
  }
  const text = createGunzip()
  file.on('error', (err) => text.destroy(err))
  file.pipe(text)
  text.setEncoding('utf8')
  return text
}

function hash (text) {
  return createHash('sha1').update(text).digest('base64')
}

function tzOf (record, shape) {
  return shape === 'wrapped' ? record.payload?._tz : record._tz
}

// Pairs a flat record with its counterpart on the other side by device and
// `_tz`, to name the fields that differ. {topic, payload} records have no
// such key (their `_tz` is stamped twice), so they are not paired.
function identity (record, shape) {
  return shape === 'flat' && record.device !== undefined ? `${record.device}@${record._tz}` : null
}

/**
 * Compares a stream's NDJSON files for one day with the Mongo documents of
 * that day. `mongoLines` yields text chunks of relaxed Extended JSON, one
 * document per line (what mongoScript prints). Records are compared as a
 * multiset, so a duplicate counts as often as it appears.
 */
export async function compareDay ({ job, mongoLines, now = new Date(), sampleLimit = SAMPLE_LIMIT }) {
  const { stream, day, shape, rawDir, services } = job
  const { start, end } = dayRange(day)
  const notes = []
  const counts = new Map()
  let ndjson = 0

  const files = services.map((service) => ({ service, paths: dayFiles(rawDir, stream, day, service) }))
  const eachNdjson = async function * () {
    for (const file of files) {
      for (const path of file.paths) {
        for await (const item of parseNdjson(readText(path))) yield { file, item }
      }
    }
  }

  for (const file of files) Object.assign(file, { records: 0, cut: 0, bad: 0, outsideDay: 0 })
  for await (const { file, item } of eachNdjson()) {
    if (item.kind !== 'record') {
      file[item.kind]++
      continue
    }
    file.records++
    ndjson++
    const tz = tzOf(item.record, shape)
    if (!(tz >= start && tz < end)) file.outsideDay++
    const key = hash(canonical(item.record, shape))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let mongo = 0
  let matched = 0
  let onlyMongo = 0
  const onlyMongoSamples = []
  let lineNo = 0
  for await (const item of parseNdjson(mongoLines)) {
    lineNo++
    if (item.kind !== 'record') {
      throw new Error(`Mongo output line ${lineNo} is not a document: ${item.text.slice(0, 200)}`)
    }
    mongo++
    const record = fromRelaxedEjson(item.record)
    const key = hash(canonical(record, shape))
    const left = counts.get(key) ?? 0
    if (left > 0) {
      matched++
      if (left === 1) counts.delete(key)
      else counts.set(key, left - 1)
    } else {
      onlyMongo++
      if (onlyMongoSamples.length < sampleLimit) onlyMongoSamples.push(record)
    }
  }

  let onlyNdjson = 0
  for (const left of counts.values()) onlyNdjson += left
  const onlyNdjsonSamples = []
  if (onlyNdjson > 0) {
    // A second pass finds the unmatched lines, so the first one keeps hashes only.
    for await (const { item } of eachNdjson()) {
      if (onlyNdjsonSamples.length >= sampleLimit) break
      if (item.kind !== 'record') continue
      const key = hash(canonical(item.record, shape))
      const left = counts.get(key) ?? 0
      if (left > 0) {
        counts.set(key, left - 1)
        onlyNdjsonSamples.push(item.record)
      }
    }
  }

  const differences = []
  const byId = new Map()
  for (const record of onlyNdjsonSamples) {
    const id = identity(record, shape)
    if (id !== null && !byId.has(id)) byId.set(id, record)
  }
  for (const record of onlyMongoSamples) {
    const id = identity(record, shape)
    if (id !== null && byId.has(id)) differences.push({ id, fields: diffPaths(record, byId.get(id)) })
  }

  for (const file of files) {
    if (file.paths.length === 0) notes.push(`${file.service}: no file`)
    if (file.paths.length > 1) notes.push(`${file.service}: both .ndjson and .ndjson.gz (both read)`)
    if (file.cut) notes.push(`${file.service}: last line cut short (skipped)`)
    if (file.bad) notes.push(`${file.service}: ${file.bad} unreadable line(s)`)
    if (file.outsideDay) notes.push(`${file.service}: ${file.outsideDay} record(s) with _tz outside the day`)
  }
  if (now.getTime() < end + idMargin(shape)) notes.push('day not over yet: counts will still change')

  return {
    stream,
    day,
    services,
    files: files.map(({ service, paths, records, cut, bad, outsideDay }) => ({ service, paths: paths.map((f) => f.path), records, cut, bad, outsideDay })),
    mongo,
    ndjson,
    matched,
    onlyMongo,
    onlyNdjson,
    equal: onlyMongo === 0 && onlyNdjson === 0,
    sampleLimit,
    notes,
    differences,
    samples: { onlyMongo: onlyMongoSamples, onlyNdjson: onlyNdjsonSamples }
  }
}

/**
 * Markdown table of results (one per stream and day; a later result of the
 * same stream and day replaces an earlier one), for the issue. It holds counts
 * and field names only: the readings themselves (`samples`) are printed only
 * when asked, for a look on the host, never for the public issue.
 */
export function renderReport (results, { samples = false } = {}) {
  const latest = new Map()
  for (const r of results) latest.set(`${r.stream}\u0000${r.day}`, r)
  const rows = [...latest.values()].sort((a, b) => a.stream.localeCompare(b.stream) || a.day.localeCompare(b.day))

  const lines = [
    '| stream | UTC day | Mongo | NDJSON | equal | notes |',
    '|---|---|---:|---:|---|---|'
  ]
  const details = []
  for (const r of rows) {
    const equal = r.equal ? 'yes' : `**no**: ${r.onlyMongo} only in Mongo, ${r.onlyNdjson} only in NDJSON`
    const perWriter = r.files.length > 1 ? [r.files.map((f) => `${f.service} ${f.records}`).join(' + ')] : []
    const notes = [...perWriter, ...r.notes].join('; ')
    lines.push(`| ${r.stream} | ${r.day} | ${r.mongo} | ${r.ndjson} | ${equal} | ${notes} |`)
    if (r.differences.length) {
      const fields = [...new Set(r.differences.flatMap((d) => d.fields))].sort()
      details.push(`- ${r.stream} ${r.day}: among the first ${r.sampleLimit} differing records of each side, ${r.differences.length} pair(s) by device and _tz differ in: ${fields.join(', ')}`)
    }
    if (samples && !r.equal) {
      for (const [side, label] of [['onlyMongo', 'only in Mongo'], ['onlyNdjson', 'only in NDJSON']]) {
        if (!r.samples[side].length) continue
        details.push(`- ${r.stream} ${r.day}, ${label} (first ${r.samples[side].length}):`, '', '```')
        for (const record of r.samples[side]) details.push(JSON.stringify(record))
        details.push('```', '')
      }
    }
  }
  const markdown = lines.join('\n') + '\n' + (details.length ? '\n' + details.join('\n') + '\n' : '')
  return { markdown, allEqual: rows.every((r) => r.equal) }
}
