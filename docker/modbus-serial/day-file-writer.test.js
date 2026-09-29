const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const {spawn} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {createDayFileWriter, utcDay} = require('./day-file-writer')

// This suite is kept identical in every service that carries a copy of
// day-file-writer.js (see the header of that file).

const CHILD = path.join(__dirname, 'test-fixtures', 'day-file-writer-child.js')

// 2026-09-28 12:00:00 UTC, well away from midnight.
const NOON = Date.UTC(2026, 8, 28, 12)
const MIDNIGHT = Date.UTC(2026, 8, 29)

let root

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'day-file-writer-'))
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

const fileOf = (day, stream = 'main', service = 'main-power') =>
  path.join(root, stream, `${day}.${service}.ndjson`)

const read = (file) => fs.readFileSync(file, 'utf8')

const linesOf = (file) => {
  const text = read(file)
  expect(text.endsWith('\n')).toBe(true)
  return text.slice(0, -1).split('\n')
}

// Runs the child harness to completion (or to its own SIGKILL) and resolves
// with how it ended.
function runChild(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, JSON.stringify(options)], {stdio: ['ignore', 'pipe', 'inherit']})
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve({code, signal}))
  })
}

describe('utcDay', () => {
  it('is the UTC calendar day of an epoch-ms instant', () => {
    expect(utcDay(NOON)).toBe('2026-09-28')
  })

  it('does not follow the local time zone', () => {
    // 23:30 UTC is already the next day in Europe/Sofia (UTC+3 in September).
    expect(utcDay(Date.UTC(2026, 8, 28, 23, 30))).toBe('2026-09-28')
  })

  it('starts a new day exactly at UTC midnight', () => {
    expect(utcDay(MIDNIGHT - 1)).toBe('2026-09-28')
    expect(utcDay(MIDNIGHT)).toBe('2026-09-29')
  })

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['undefined', undefined],
    ['null', null],
    ['a numeric string', String(NOON)],
    ['out of Date range', 8.64e15 + 1],
    ['beyond year 9999', Date.UTC(10000, 0, 1)],
  ])('is null for %s', (_, value) => {
    expect(utcDay(value)).toBeNull()
  })
})

describe('createDayFileWriter', () => {
  it('writes each value as one JSON line to <root>/<stream>/<UTC day>.<service>.ndjson', () => {
    const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

    const file = writer.write({a: 1}, NOON)
    writer.write({b: 'two'}, NOON + 1000)
    writer.close()

    expect(file).toBe(fileOf('2026-09-28'))
    expect(linesOf(file)).toEqual(['{"a":1}', '{"b":"two"}'])
  })

  it('creates the stream directory when it does not exist', () => {
    const writer = createDayFileWriter({root, stream: 'monitoring', service: 'solar'})

    writer.write({a: 1}, NOON)
    writer.close()

    expect(fs.existsSync(fileOf('2026-09-28', 'monitoring', 'solar'))).toBe(true)
  })

  it('keeps two services that share a stream in separate files', () => {
    const monitoring = createDayFileWriter({root, stream: 'monitoring', service: 'monitoring'})
    const solar = createDayFileWriter({root, stream: 'monitoring', service: 'solar'})

    monitoring.write({from: 'monitoring'}, NOON)
    solar.write({from: 'solar'}, NOON)
    monitoring.close()
    solar.close()

    expect(linesOf(fileOf('2026-09-28', 'monitoring', 'monitoring'))).toEqual(['{"from":"monitoring"}'])
    expect(linesOf(fileOf('2026-09-28', 'monitoring', 'solar'))).toEqual(['{"from":"solar"}'])
  })

  it('has the line on disk as soon as write returns, before close', () => {
    const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

    const file = writer.write({a: 1}, NOON)

    expect(read(file)).toBe('{"a":1}\n')
    writer.close()
  })

  it('appends to an existing file instead of truncating it', () => {
    const first = createDayFileWriter({root, stream: 'main', service: 'main-power'})
    first.write({run: 1}, NOON)
    first.close()

    const second = createDayFileWriter({root, stream: 'main', service: 'main-power'})
    second.write({run: 2}, NOON)
    second.close()

    expect(linesOf(fileOf('2026-09-28'))).toEqual(['{"run":1}', '{"run":2}'])
  })

  it('opens the day file once, not once per line', () => {
    const openSync = jest.spyOn(fs, 'openSync')
    const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

    for (let i = 0; i < 50; i++) writer.write({i}, NOON + i)
    writer.close()

    const appendOpens = openSync.mock.calls.filter(([, flags]) => flags === 'a')
    expect(appendOpens).toEqual([[fileOf('2026-09-28'), 'a']])
  })

  it('moves to the next day\'s file at UTC midnight', () => {
    const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

    writer.write({before: true}, MIDNIGHT - 1)
    writer.write({after: true}, MIDNIGHT)
    writer.close()

    expect(linesOf(fileOf('2026-09-28'))).toEqual(['{"before":true}'])
    expect(linesOf(fileOf('2026-09-29'))).toEqual(['{"after":true}'])
  })

  // The day is the UTC day of the value's own timestamp, not of when it was
  // written: a reading stamped 23:59:59.999 and handed over just after midnight
  // still belongs to the day it was taken.
  it('files a value by its own timestamp even when it arrives after midnight', () => {
    const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

    writer.write({n: 1}, MIDNIGHT + 5)
    writer.write({n: 2}, MIDNIGHT - 5)
    writer.write({n: 3}, MIDNIGHT + 10)
    writer.close()

    expect(linesOf(fileOf('2026-09-28'))).toEqual(['{"n":2}'])
    expect(linesOf(fileOf('2026-09-29'))).toEqual(['{"n":1}', '{"n":3}'])
  })

  describe('opening a file whose last line was cut short', () => {
    it('ends the cut line before writing, so the two are never glued', () => {
      fs.mkdirSync(path.join(root, 'main'))
      fs.writeFileSync(fileOf('2026-09-28'), '{"a":1}\n{"cut":')
      const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

      writer.write({b: 2}, NOON)
      writer.close()

      expect(linesOf(fileOf('2026-09-28'))).toEqual(['{"a":1}', '{"cut":', '{"b":2}'])
    })

    it('adds nothing to a file that already ends in a newline', () => {
      fs.mkdirSync(path.join(root, 'main'))
      fs.writeFileSync(fileOf('2026-09-28'), '{"a":1}\n')
      const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

      writer.write({b: 2}, NOON)
      writer.close()

      expect(read(fileOf('2026-09-28'))).toBe('{"a":1}\n{"b":2}\n')
    })

    it('adds nothing to an empty file', () => {
      fs.mkdirSync(path.join(root, 'main'))
      fs.writeFileSync(fileOf('2026-09-28'), '')
      const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

      writer.write({b: 2}, NOON)
      writer.close()

      expect(read(fileOf('2026-09-28'))).toBe('{"b":2}\n')
    })
  })

  // A failed write (a full disk, say) can leave part of a line behind. The next
  // write must not append straight onto it: the writer reopens the file and
  // ends the cut line first, exactly as after a crash.
  it('recovers from a write that failed half way through a line', () => {
    const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})
    writer.write({a: 1}, NOON)
    const realWriteSync = fs.writeSync
    jest.spyOn(fs, 'writeSync').mockImplementationOnce((fd, buffer) => {
      realWriteSync(fd, buffer, 0, 5)
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), {code: 'ENOSPC'})
    })

    expect(() => writer.write({lost: true}, NOON)).toThrow('ENOSPC')
    writer.write({c: 3}, NOON)
    writer.close()

    expect(linesOf(fileOf('2026-09-28'))).toEqual(['{"a":1}', '{"los', '{"c":3}'])
  })

  describe('rejecting what it cannot file', () => {
    it.each([
      ['NaN', NaN],
      ['undefined', undefined],
      ['a string', '2026-09-28'],
    ])('throws on a timestamp that is %s, and writes nothing', (_, timestamp) => {
      const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})

      expect(() => writer.write({a: 1}, timestamp)).toThrow(TypeError)
      writer.close()

      expect(fs.existsSync(path.join(root, 'main'))).toBe(false)
    })

    it('throws on a value JSON cannot represent, and leaves no partial line', () => {
      const writer = createDayFileWriter({root, stream: 'main', service: 'main-power'})
      writer.write({a: 1}, NOON)

      expect(() => writer.write({big: 1n}, NOON)).toThrow(TypeError)
      expect(() => writer.write(undefined, NOON)).toThrow(TypeError)
      writer.write({b: 2}, NOON)
      writer.close()

      expect(linesOf(fileOf('2026-09-28'))).toEqual(['{"a":1}', '{"b":2}'])
    })

    it.each([
      ['empty', ''],
      ['a parent reference', '..'],
      ['a current-directory reference', '.'],
      ['a path', 'a/b'],
      ['absolute', '/etc'],
      ['not a string', undefined],
    ])('refuses a stream or service name that is %s', (_, name) => {
      expect(() => createDayFileWriter({root, stream: name, service: 'main-power'})).toThrow(/stream/)
      expect(() => createDayFileWriter({root, stream: 'main', service: name})).toThrow(/service/)
    })

    it('refuses a missing root directory setting', () => {
      expect(() => createDayFileWriter({root: undefined, stream: 'main', service: 'main-power'})).toThrow(/root/)
      expect(() => createDayFileWriter({root: '', stream: 'main', service: 'main-power'})).toThrow(/root/)
    })
  })

  // Real processes, real kill -9. The writer uses fs.writeSync precisely so a
  // process that exits or is killed has already handed every finished line to
  // the kernel; a WriteStream would still be holding them in memory.
  describe('across a crash', () => {
    const SERVICE = 'crash-test'
    const recordsIn = (file) => read(file).split('\n').filter((line) => line !== '')

    it('loses no line when the process exits right after writing', async () => {
      const result = await runChild({root, stream: 'main', service: SERVICE, timestamp: NOON, run: 1, count: 200})

      expect(result).toEqual({code: 0, signal: null})
      const lines = linesOf(fileOf('2026-09-28', 'main', SERVICE))
      expect(lines).toHaveLength(200)
      expect(JSON.parse(lines[199])).toMatchObject({run: 1, seq: 199})
    })

    it('never glues the line a kill -9 cut short to the first line after the restart', async () => {
      // The first run writes 10 whole lines, then half of an 11th, then is
      // killed with SIGKILL before it can finish it.
      const killed = await runChild({root, stream: 'main', service: SERVICE, timestamp: NOON, run: 1, count: 10, tear: true})
      expect(killed.signal).toBe('SIGKILL')
      const file = fileOf('2026-09-28', 'main', SERVICE)
      expect(read(file).endsWith('\n')).toBe(false)

      await runChild({root, stream: 'main', service: SERVICE, timestamp: NOON, run: 2, count: 10})

      const lines = linesOf(file)
      expect(lines).toHaveLength(21)
      expect(() => JSON.parse(lines[10])).toThrow()
      const parsed = lines.filter((_, i) => i !== 10).map((line) => JSON.parse(line))
      expect(parsed.filter((r) => r.run === 1)).toHaveLength(10)
      expect(parsed.filter((r) => r.run === 2).map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    // Killed at a random moment while writing large lines, restarted each time.
    // Whether a given kill lands inside a line is up to the kernel; whatever it
    // does, no line may hold the start of more than one record, and every line
    // a later run wrote must be intact.
    it('never glues lines across repeated kill -9 at random moments', async () => {
      const file = fileOf('2026-09-28', 'main', SERVICE)
      const CYCLES = 5

      for (let run = 1; run <= CYCLES; run++) {
        const child = spawn(process.execPath, [CHILD, JSON.stringify({root, stream: 'main', service: SERVICE, timestamp: NOON, run, count: -1, pad: 256 * 1024})], {stdio: ['ignore', 'pipe', 'inherit']})
        await new Promise((resolve) => child.stdout.once('data', resolve))
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 25))
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGKILL')
        await exited
      }
      await runChild({root, stream: 'main', service: SERVICE, timestamp: NOON, run: CYCLES + 1, count: 3})

      const lines = recordsIn(file)
      const unparseable = lines.filter((line) => {
        try { JSON.parse(line); return false } catch { return true }
      })
      for (const line of lines) {
        expect(line.split('{"run":').length - 1).toBe(1)
      }
      expect(unparseable.length).toBeLessThanOrEqual(CYCLES)
      const last = lines.slice(-3).map((line) => JSON.parse(line))
      expect(last.map((r) => [r.run, r.seq])).toEqual([[CYCLES + 1, 0], [CYCLES + 1, 1], [CYCLES + 1, 2]])
    }, 30000)
  })
})
