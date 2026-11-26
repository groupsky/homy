const path = require('path')
const {afterEach, describe, expect, it, jest} = require('@jest/globals')

/**
 * Runs the real reader (index.js, the mbsl32di driver, the deployed
 * config/modbus-serial/dry-switches.js) against a fake Modbus bus and a fake
 * clock, and replays the power dips of #2007.
 *
 * The fake bus answers at once, so one poll pass of the four devices takes
 * about 21 ms (4 x msDelayBetweenDevices of 5 ms, and the next pass starts
 * one tick later): mbsl32di2 is read 5 ms after mbsl32di1.
 */

const CONFIG = path.resolve(__dirname, '../../config/modbus-serial/dry-switches.js')
const CONFIG_NO_GUARD = path.resolve(__dirname, 'test-fixtures/dry-switches-no-guard.js')
const T0 = Date.UTC(2026, 10, 16, 18, 0, 0)
const DIP = 1000 // the dip starts 1 s after the reader started
const DI1 = 31 // Modbus addresses in dry-switches.js
const DI2 = 32
// one poll pass on the fake bus, with a little room
const PASS_MS = 22
const INTEGRATIONS = ['console', 'mqtt', 'mongodb', 'ndjson', 'influxdb']

// A module's value over time: [[ms from T0, value or 'timeout'], ...]
const timeline = (initial, changes = []) => (t) => {
  let value = initial
  for (const [at, next] of changes) if (t >= at) value = next
  return value
}

const timeoutError = () => Object.assign(new Error('Timed out'), {name: 'TransactionTimedOutError'})

function startReader ({config = CONFIG, di1, di2}) {
  const published = [] // what the mqtt integration got, with the publish time
  const influx = []
  const logs = []
  const script = {[DI1]: di1, [DI2]: di2}

  class FakeModbus {
    connectRTUBuffered () { return Promise.resolve() }
    setTimeout () {}
    setID (id) { this.id = id; return Promise.resolve() }
    close (cb) { cb() }
    async readHoldingRegisters (addr, len) {
      if (!script[this.id]) return {data: new Array(len).fill(0)}
      const value = script[this.id](Date.now() - T0)
      if (value === 'timeout') throw timeoutError()
      return {data: [value & 0xFFFF, (value >>> 16) & 0xFFFF]}
    }
    async readInputRegisters (addr, len) { return {data: new Array(len).fill(0)} }
  }

  jest.useFakeTimers({now: T0})
  jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.doMock('modbus-serial', () => FakeModbus)
  for (const name of INTEGRATIONS) {
    jest.doMock(`./integrations/${name}`, () => () => ({
      publish: (entry, device) => {
        const copy = {...entry, at: Date.now() - T0, name: device.name}
        if (name === 'mqtt') published.push(copy)
        if (name === 'influxdb') influx.push(copy)
      },
    }))
  }
  process.env.CONFIG = config
  jest.isolateModules(() => require('./index'))

  const of = (name) => published.filter((p) => p.name === name)
  return {
    run: (ms) => jest.advanceTimersByTimeAsync(ms),
    published,
    influx,
    logs,
    inputs: (name) => of(name).map((p) => p.inputs >>> 0),
    readings: of,
    events: () => of('power-dip'),
  }
}

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  process.removeAllListeners('SIGTERM')
  delete process.env.CONFIG
})

// The three recorded dips with a partial reading (#2007, "Test data"),
// times in ms from the first partial reading.
const DIPS = [
  {
    name: 'dip 1 (back after 208 s)',
    di1: {before: 0xdfa8001b, partial: 0x00200013, partialAt: 0, zeroAt: 37, backAt: 208000},
    di2: {before: 0x00000cba, partial: 0x000000b8, partialAt: 13, zeroAt: 51, backAt: 208000},
  },
  {
    name: 'dip 2 (back after about 7 min)',
    di1: {before: 0xffa8001f, partial: 0x00000002, partialAt: 0, zeroAt: 35, backAt: 420000},
    di2: {before: 0x0030048b, partial: 0x00000088, partialAt: 12, zeroAt: 48, backAt: 420000},
  },
  {
    name: 'dip 3 (back after 4.4 s)',
    di1: {before: 0xffa8001f, partial: 0x20200013, partialAt: 0, zeroAt: 37, backAt: 4433},
    di2: {before: 0x00302c93, partial: 0x00202091, partialAt: 14, zeroAt: 49, backAt: 4521},
  },
]

const dipTimeline = ({before, partial, partialAt, zeroAt, backAt}, back = before) => timeline(before, [
  [DIP + partialAt, partial],
  [DIP + zeroAt, 0],
  [DIP + backAt, back],
])

describe('power dip guard in the dry-switches reader', () => {
  describe.each(DIPS)('replay of $name', ({di1, di2}) => {
    const lastBack = Math.max(di1.backAt, di2.backAt)

    it('leaves every published input value as before and sends one start and one end event', async () => {
      const reader = startReader({di1: dipTimeline(di1), di2: dipTimeline(di2)})
      await reader.run(DIP + lastBack + 2000)

      expect(reader.inputs('mbsl32di1').length).toBeGreaterThan(0)
      expect(new Set(reader.inputs('mbsl32di1'))).toEqual(new Set([di1.before]))
      expect(new Set(reader.inputs('mbsl32di2'))).toEqual(new Set([di2.before]))
      // both modules are published again at the dip end
      expect(reader.readings('mbsl32di1').some((p) => p.at >= DIP + di1.backAt)).toBe(true)
      expect(reader.readings('mbsl32di2').some((p) => p.at >= DIP + di2.backAt)).toBe(true)

      const events = reader.events()
      expect(events.map((e) => e.state)).toEqual(['start', 'end'])
      expect(events[0]).toMatchObject({_type: 'power-dip', device: 'power-dip', durationMs: 0})
      expect(events[1].durationMs).toBeGreaterThanOrEqual(lastBack - 20)
      expect(events[1].durationMs).toBeLessThanOrEqual(lastBack + 40)
      // the held raw readings, so the dip can still be studied
      const held = events[1].readings.map((r) => `${r.device}=${r.inputs.toString(16)}`)
      expect(held).toEqual(expect.arrayContaining([
        `mbsl32di1=${di1.partial.toString(16)}`, 'mbsl32di1=0',
        `mbsl32di2=${di2.partial.toString(16)}`, 'mbsl32di2=0',
      ]))
      // the reader's own InfluxDB measurement gets no dip event
      expect(reader.influx.some((p) => p.name === 'power-dip')).toBe(false)

      expect(reader.logs.filter((l) => l.startsWith('power dip start'))).toHaveLength(1)
      expect(reader.logs.filter((l) => /^power dip end after \d+ ms/.test(l))).toHaveLength(1)
    })

    it('without the guard publishes the partial readings (what the guard fixes)', async () => {
      const reader = startReader({config: CONFIG_NO_GUARD, di1: dipTimeline(di1), di2: dipTimeline(di2)})
      await reader.run(DIP + 200)
      expect(reader.inputs('mbsl32di1')).toContain(di1.partial)
      expect(reader.inputs('mbsl32di2')).toContain(di2.partial)
    })
  })

  it('logs a line every 5 minutes while a dip lasts', async () => {
    const {di1, di2} = DIPS[1]
    const reader = startReader({di1: dipTimeline(di1), di2: dipTimeline(di2)})
    await reader.run(DIP + di1.backAt + 2000)
    expect(reader.logs.filter((l) => l.startsWith('power dip still on after'))).toHaveLength(1)
  })

  it('publishes nothing in a dip with no partial reading until the module is back', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0], [DIP + 4500, 0xffa8001f]]),
      di2: timeline(0x00302c93, [[DIP + 13, 0], [DIP + 4500, 0x00302c93]]),
    })
    await reader.run(DIP + 6000)
    const during = reader.published.filter((p) => p.at >= DIP && p.at < DIP + 4500 && p.name !== 'power-dip')
    expect(during).toEqual([])
    expect(new Set(reader.inputs('mbsl32di1'))).toEqual(new Set([0xffa8001f]))
    expect(new Set(reader.inputs('mbsl32di2'))).toEqual(new Set([0x00302c93]))
    expect(reader.events().map((e) => e.state)).toEqual(['start', 'end'])
  })

  it('publishes nothing of a dip whose first sign is a 1-bit change on mbsl32di2', async () => {
    const reader = startReader({
      // mbsl32di2 is read at 1015: one bit dropped; mbsl32di1 at 1030: a big change
      di1: timeline(0xffa8001f, [[DIP + 20, 0x00000002], [DIP + 45, 0], [DIP + 4500, 0xffa8001f]]),
      di2: timeline(0x00302c93, [[DIP + 3, 0x00302c92], [DIP + 45, 0], [DIP + 4500, 0x00302c93]]),
    })
    await reader.run(DIP + 6000)
    expect(new Set(reader.inputs('mbsl32di1'))).toEqual(new Set([0xffa8001f]))
    expect(new Set(reader.inputs('mbsl32di2'))).toEqual(new Set([0x00302c93]))
    expect(reader.events().map((e) => e.state)).toEqual(['start', 'end'])
  })

  it('holds a 1-bit change through a pass where both reads fail, and publishes it after the next good pass', async () => {
    const reader = startReader({
      // mbsl32di1 reads the change once, then both modules time out
      di1: timeline(0xffa8001f, [[DIP, 0xffa8001e], [DIP + PASS_MS, 'timeout'], [DIP + 400, 0xffa8001e]]),
      // (mbsl32di2 is read 5 ms after mbsl32di1, so it fails in the same pass)
      di2: timeline(0x00302c93, [[DIP + 5, 'timeout'], [DIP + 400, 0x00302c93]]),
    })
    await reader.run(DIP + 390)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f])
    await reader.run(400)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa8001e])
    const change = reader.readings('mbsl32di1')[1]
    // it keeps the time it was read, not the time it was published
    expect(change._tz - T0).toBeGreaterThanOrEqual(DIP)
    expect(change._tz - T0).toBeLessThan(DIP + PASS_MS)
    expect(change.at).toBeGreaterThanOrEqual(DIP + 400)
    // a read retry (100 ms) may still run at 400 ms, then one good pass
    expect(change.at).toBeLessThanOrEqual(DIP + 400 + 100 + 2 * PASS_MS)
    expect(reader.events()).toEqual([])
  })

  it('does not let a module that stopped answering block the other one for more than stableMs', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa8001e]]),
      di2: timeline(0x00302c93, [[DIP - 500, 'timeout']]),
    })
    // a failing read is retried after 100 ms, and after 11 errors the reader
    // reconnects (5 s), so mbsl32di1 is read less often here
    await reader.run(DIP + 10000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa8001e])
    const change = reader.readings('mbsl32di1')[1]
    expect(change.at - (change._tz - T0)).toBeGreaterThanOrEqual(1000)
    // stableMs, plus the 5 s reconnect pause of the whole bus
    expect(change.at - (change._tz - T0)).toBeLessThan(1000 + 5000 + 1000)
    expect(reader.events()).toEqual([])
  })

  it('publishes a change of a module that then stops answering after maxHoldMs, and does not block the other', async () => {
    // mbsl32di1 reads the change once, then never answers again
    let changeRead = false
    const reader = startReader({
      di1: (t) => t < DIP ? 0xffa8001f : changeRead ? 'timeout' : (changeRead = true, 0xffa8001e),
      di2: timeline(0x00302c93, [[DIP + 2000, 0x00302c13]]),
    })
    await reader.run(DIP + 9000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f])
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93])
    // maxHoldMs is 10 s; the reader's reconnect pauses make the reads rare
    await reader.run(30000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa8001e])
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93, 0x00302c13])
    expect(reader.events()).toEqual([])
  })

  it('does not keep a false dip open for a module that never answers', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018], [DIP + 20000, 0xffa80019]]),
      di2: () => 'timeout',
    })
    // maxHoldMs is 10 s; the reader's reconnect pauses make the reads rare
    await reader.run(DIP + 16000)
    // the 3-bit change is not lost
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa80018])
    await reader.run(15000)
    // a later 1-bit change is published again (not held for ever)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa80018, 0xffa80019])
    expect(reader.readings('mbsl32di1').every((p) => p.at - (p._tz - T0) < 12000)).toBe(true)
  })

  it('ends a false dip when the other module stops answering during it', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018], [DIP + 20000, 0xffa80019]]),
      di2: timeline(0x00302c93, [[DIP - 5, 'timeout']]),
    })
    await reader.run(DIP + 40000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa80018, 0xffa80019])
    expect(reader.readings('mbsl32di1').every((p) => p.at - (p._tz - T0) < 20000)).toBe(true)
  })

  it('publishes a single switch change after at most one extra poll pass', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa8001e], [DIP + 500, 0xffa8001f]]),
      di2: timeline(0x00302c93, [[DIP + 200, 0x00302c13]]),
    })
    await reader.run(DIP + 1000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa8001e, 0xffa8001f])
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93, 0x00302c13])
    const changes = reader.published.filter((p) => p.at >= DIP)
    expect(changes).toHaveLength(3)
    for (const change of changes) {
      const delay = change.at - (change._tz - T0)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(PASS_MS)
    }
    expect(reader.events()).toEqual([])
  })

  it('publishes a change of two neighbouring bits on mbsl32di2 (a double button) after one pass', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f),
      di2: timeline(0x00302c93, [[DIP, 0x00302093]]), // bits 10 and 11
    })
    await reader.run(DIP + 500)
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93, 0x00302093])
    const change = reader.readings('mbsl32di2')[1]
    expect(change.at - (change._tz - T0)).toBeLessThanOrEqual(PASS_MS)
    expect(reader.events()).toEqual([])
  })

  it('publishes a 3-bit press let go within stableMs (no 0 read) late, press then release, with own _tz', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018], [DIP + 300, 0xffa8001f]]),
      di2: timeline(0x00302c93),
    })
    await reader.run(DIP + 3000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa80018, 0xffa8001f])
    const [, press, release] = reader.readings('mbsl32di1')
    expect(press._tz - T0).toBeGreaterThanOrEqual(DIP)
    expect(press._tz - T0).toBeLessThan(DIP + PASS_MS)
    expect(release._tz - T0).toBeGreaterThanOrEqual(DIP + 300)
    expect(press.at).toBeGreaterThanOrEqual(release._tz - T0)
    expect(release.at).toBeGreaterThanOrEqual(press.at)
    expect(reader.inputs('mbsl32di2')[0]).toBe(0x00302c93)
  })

  it('publishes a held 1-bit press and its release when a false dip on the other module ends in between', async () => {
    const reader = startReader({
      // mbsl32di1: press at the start, let go before the dip ends
      di1: timeline(0xffa8001f, [[DIP, 0xffa8001e], [DIP + 200, 0xffa8001f]]),
      // mbsl32di2 (read 5 ms later): 3 bits change in the same pass, back later
      di2: timeline(0x00302c93, [[DIP + 3, 0x00300013], [DIP + 300, 0x00302c93]]),
    })
    await reader.run(DIP + 3000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa8001e, 0xffa8001f])
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93, 0x00300013, 0x00302c93])
    const dipPart = reader.published.filter((p) => p.at >= DIP && p.name !== 'power-dip')
    expect(dipPart.map((p) => `${p.name}=${(p.inputs >>> 0).toString(16)}`)).toEqual([
      'mbsl32di1=ffa8001e', 'mbsl32di2=300013', 'mbsl32di1=ffa8001f', 'mbsl32di2=302c93',
    ])
    const tz = dipPart.map((p) => p._tz)
    expect(tz).toEqual([...tz].sort((x, y) => x - y))
    expect(reader.events().map((e) => e.state)).toEqual(['start', 'end'])
  })

  it('false dip where the modules end at different times: nothing lost, no duplicate, order kept', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018], [DIP + 200, 0xffa8001f]]),
      di2: timeline(0x00302c93, [[DIP + 100, 0x00302c92]]), // 1 bit, stays changed
    })
    await reader.run(DIP + 3000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa80018, 0xffa8001f])
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93, 0x00302c92])
    const tz = reader.published.filter((p) => p.name !== 'power-dip' && p.at >= DIP).map((p) => p._tz)
    expect(tz).toEqual([...tz].sort((x, y) => x - y))
    // nothing is published before the last module ended (stableMs after its change)
    expect(Math.min(...reader.published.filter((p) => p.at >= DIP && p.name !== 'power-dip').map((p) => p.at))).toBeGreaterThanOrEqual(DIP + 1000)
  })

  it('a dip that becomes real after one module ended leaks nothing and restores once', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018], [DIP + 200, 0xffa8001f]]),
      di2: timeline(0x00302c93, [[DIP + 100, 0x00302c92], [DIP + 300, 0], [DIP + 4500, 0x00302c93]]),
    })
    await reader.run(DIP + 6000)
    expect(new Set(reader.inputs('mbsl32di1'))).toEqual(new Set([0xffa8001f]))
    expect(reader.inputs('mbsl32di1').filter((v) => v !== 0xffa8001f)).toEqual([])
    expect(new Set(reader.inputs('mbsl32di2'))).toEqual(new Set([0x00302c93]))
    const di1 = reader.readings('mbsl32di1').filter((p) => p.at >= DIP)
    expect(di1).toHaveLength(0) // restore equals the published value: not published again
    expect(reader.events().map((e) => e.state)).toEqual(['start', 'end'])
  })

  it('a module that ended early and then reads 0 makes the dip real: nothing leaks', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018], [DIP + 200, 0xffa8001f], [DIP + 250, 0], [DIP + 4500, 0xffa8001f]]),
      di2: timeline(0x00302c93, [[DIP + 100, 0x00302c92], [DIP + 300, 0x00302c93]]),
    })
    await reader.run(DIP + 6000)
    expect(new Set(reader.inputs('mbsl32di1'))).toEqual(new Set([0xffa8001f]))
    expect(new Set(reader.inputs('mbsl32di2'))).toEqual(new Set([0x00302c93]))
    // only restores of the value from before the dip, never a value of the dip
    const during = reader.published.filter((p) => p.name !== 'power-dip' && p.at >= DIP)
    for (const p of during) expect(p.inputs >>> 0).toBe(p.name === 'mbsl32di1' ? 0xffa8001f : 0x00302c93)
    expect(reader.events().map((e) => e.state)).toEqual(['start', 'end'])
  })

  it('publishes a real change of 3 bits after stableMs, not lost', async () => {
    const reader = startReader({
      di1: timeline(0xffa8001f, [[DIP, 0xffa80018]]), // bits 0, 1 and 2
      di2: timeline(0x00302c93),
    })
    await reader.run(DIP + 3000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa80018])
    const change = reader.readings('mbsl32di1')[1]
    expect(change.at).toBeGreaterThanOrEqual(DIP + 1000)
    expect(change.at).toBeLessThanOrEqual(DIP + 1100)
    expect(reader.events().map((e) => e.state)).toEqual(['start', 'end'])
  })

  it('publishes a switch moved during a dip once, at the dip end', async () => {
    const {di1, di2} = DIPS[2]
    const moved = di2.before ^ (1 << 10)
    const reader = startReader({di1: dipTimeline(di1), di2: dipTimeline(di2, moved)})
    await reader.run(DIP + di2.backAt + 3000)
    expect(new Set(reader.inputs('mbsl32di1'))).toEqual(new Set([di1.before]))
    const di2Values = reader.inputs('mbsl32di2')
    expect(di2Values.filter((v) => v === moved)).toHaveLength(1)
    expect(di2Values.filter((v) => v !== moved && v !== di2.before)).toEqual([])
    const late = reader.readings('mbsl32di2').find((p) => (p.inputs >>> 0) === moved)
    const end = reader.events().find((e) => e.state === 'end')
    expect(late.at).toBeGreaterThanOrEqual(DIP + di2.backAt)
    expect(end._tz - T0).toBe(late.at)
  })

  it('without the guard config publishes every reading at once and in order, as before', async () => {
    const changes = [[DIP, 0xffa8001e], [DIP + 100, 0x20200013], [DIP + 140, 0], [DIP + 300, 0xffa8001f]]
    const reader = startReader({
      config: CONFIG_NO_GUARD,
      di1: timeline(0xffa8001f, changes),
      di2: timeline(0x00302c93, [[DIP + 113, 0x00202091], [DIP + 152, 0], [DIP + 300, 0x00302c93]]),
    })
    await reader.run(DIP + 1000)
    expect(reader.inputs('mbsl32di1')).toEqual([0xffa8001f, 0xffa8001e, 0x20200013, 0, 0xffa8001f])
    expect(reader.inputs('mbsl32di2')).toEqual([0x00302c93, 0x00202091, 0, 0x00302c93])
    for (const reading of reader.published) {
      expect(reading.at).toBe(reading._tz - T0)
    }
    expect(Object.keys(reader.readings('mbsl32di1')[0]))
      .toEqual(['inputs', '_tz', '_ms', '_addr', '_type', 'device', 'at', 'name'])
    expect(reader.events()).toEqual([])
    expect(reader.logs.filter((l) => l.startsWith('power dip'))).toEqual([])
  })
})
