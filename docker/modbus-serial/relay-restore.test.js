const path = require('path')
const {afterEach, describe, expect, it, jest} = require('@jest/globals')

/**
 * Runs the real reader (index.js, the aspar-mod-16ro and mbsl32di drivers,
 * the deployed config/modbus-serial/dry-switches.js) against a fake Modbus
 * bus and a fake clock, and restarts the relay boards (#2008).
 */

const CONFIG = path.resolve(__dirname, '../../config/modbus-serial/dry-switches.js')
const CONFIG_PLAIN_RELAY = path.resolve(__dirname, 'test-fixtures/dry-switches-plain-relay.js')
const T0 = Date.UTC(2026, 10, 25, 18, 0, 0)
const MIN = 60 * 1000
const RELAYS00 = 1 // Modbus addresses in dry-switches.js
const RELAYS16 = 2
const DI1 = 31
const DI2 = 32
const INTEGRATIONS = ['console', 'mqtt', 'mongodb', 'ndjson', 'influxdb']

const timeoutError = () => Object.assign(new Error('Timed out'), {name: 'TransactionTimedOutError'})

// A MOD-16RO: the received-packets counter counts every request; a restart
// sets it near 0 and the outputs to the power-up state (all off).
function fakeBoard (outputs = 0) {
  const board = {counter: 40000, outputs, defaults: 0, up: true, writes: []}
  board.restart = () => {
    board.counter = 3
    board.outputs = board.defaults
  }
  board.inputRegister = (r) => ({0x0C: board.defaults, 0x20: board.counter & 0xFFFF, 0x21: board.counter >>> 16, 0x33: board.outputs})[r] || 0
  return board
}

function startReader ({config = CONFIG, boards}) {
  const published = []
  const logs = []
  const requests = [] // [ms from T0, address, kind, register, length]
  const subscribers = {}
  const closes = []

  // Each request takes 2 ms on the bus; a board that does not answer takes
  // msTimeout (50 ms) and then fails, like the real client.
  class FakeModbus {
    connectRTUBuffered () { return Promise.resolve() }
    setTimeout () {}
    setID (id) { this.id = id; return Promise.resolve() }
    close (cb) { closes.push(Date.now() - T0); cb() }
    async request (kind, addr, len) {
      requests.push([Date.now() - T0, this.id, kind, addr, len])
      const board = boards[this.id]
      if (board && !board.up) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        throw timeoutError()
      }
      await new Promise((resolve) => setTimeout(resolve, 2))
      if (board) board.counter = (board.counter + 1) >>> 0
      return board
    }
    async readHoldingRegisters (addr, len) {
      await this.request('holding', addr, len)
      return {data: new Array(len).fill(0)}
    }
    async readInputRegisters (addr, len) {
      const board = await this.request('input', addr, len)
      return {data: Array.from({length: len}, (_, i) => board ? board.inputRegister(addr + i) : 0)}
    }
    async writeCoil (addr, value) {
      const board = await this.request('coil', addr, 1)
      board.writes.push(`${addr >= 0x330 ? 'out' : 'def'}${addr & 0x0F}=${value}`)
      const word = addr >= 0x330 ? 'outputs' : 'defaults'
      board[word] = value ? board[word] | (1 << (addr & 0x0F)) : board[word] & ~(1 << (addr & 0x0F))
    }
  }

  jest.useFakeTimers({now: T0})
  jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
  jest.spyOn(console, 'error').mockImplementation((...args) => logs.push(args.join(' ')))
  jest.doMock('modbus-serial', () => FakeModbus)
  for (const name of INTEGRATIONS) {
    jest.doMock(`./integrations/${name}`, () => () => ({
      publish: (entry, device) => {
        if (name === 'mqtt') published.push({...entry, at: Date.now() - T0, name: device.name})
      },
      ...(name === 'mqtt' && {subscribe: async (device, callback) => { subscribers[device.name] = callback }}),
    }))
  }
  process.env.CONFIG = config
  jest.isolateModules(() => require('./index'))

  return {
    run: (ms) => jest.advanceTimersByTimeAsync(ms),
    // an MQTT command on the device's write topic; the clock runs on while
    // it waits for the bus
    command: async (name, message) => {
      const done = subscribers[name](message)
      await jest.advanceTimersByTimeAsync(200)
      await done
    },
    reports: (name) => published.filter((p) => p.name === name),
    requests: (address) => requests.filter((r) => r[1] === address),
    logs,
    closes,
  }
}

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  process.removeAllListeners('SIGTERM')
  delete process.env.CONFIG
})

describe('relay board restore in the dry-switches reader', () => {
  it('a restart is noticed within about 1 s, the lights get their wanted value back, and a report is published', async () => {
    const boards = {[RELAYS00]: fakeBoard(), [RELAYS16]: fakeBoard()}
    const reader = startReader({boards})
    await reader.run(2000)
    await reader.command('relays00-15', {out9: true})
    await reader.command('relays00-15', {out14: true})
    await reader.command('relays16-31', {out8: true})
    await reader.run(2000)
    expect(boards[RELAYS00].outputs).toBe((1 << 9) | (1 << 14))

    // the dip: both boards gone for 3 s, back with all outputs off
    for (const board of Object.values(boards)) board.up = false
    await reader.run(3000)
    for (const board of Object.values(boards)) {
      board.restart()
      board.up = true
    }
    const backAt = Date.now() - T0
    const before = reader.reports('relays00-15').length
    await reader.run(10000)

    expect(boards[RELAYS00].outputs).toBe((1 << 9) | (1 << 14))
    expect(boards[RELAYS16].outputs).toBe(1 << 8)
    const report = reader.reports('relays00-15')[before]
    expect(report.outputs).toBe((1 << 9) | (1 << 14))
    // the back-off after 3 s down: tries at 1, 2 and 4 s, so the next try
    // after the board is back is at most 4 s later; then it is noticed at once
    expect(report.at - backAt).toBeLessThanOrEqual(4100)
    const lines = reader.logs.filter((l) => l.includes('restarted'))
    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.startsWith('relays00-15'))).toMatch(/gone \d+ ms: wrote out9=true \(last report\), out14=true \(last report\)$/)
    expect(lines.find((l) => l.startsWith('relays16-31'))).toMatch(/wrote out8=true/)
  })

  it('a restart while the board answers is noticed within about 1 s', async () => {
    const boards = {[RELAYS00]: fakeBoard(1 << 13), [RELAYS16]: fakeBoard()}
    const reader = startReader({boards})
    await reader.run(5000)
    boards[RELAYS00].restart()
    const before = reader.reports('relays00-15').length
    await reader.run(1200)
    const report = reader.reports('relays00-15')[before]
    expect(report.at - 5000).toBeLessThanOrEqual(1100)
    expect(report.outputs).toBe(1 << 13)
    expect(boards[RELAYS00].writes).toEqual(['out13=true'])
  })

  it('notices a restart that happens between the counter read and the report read', async () => {
    const boards = {[RELAYS00]: fakeBoard(1 << 13), [RELAYS16]: fakeBoard()}
    const reader = startReader({boards})
    await reader.run(7 * MIN - 5000)
    // the next report is due in about 5 s; the board restarts right after it answers the next counter read
    const board = boards[RELAYS00]
    const inputRegister = board.inputRegister
    board.inputRegister = (r) => {
      const value = inputRegister(r)
      if (r === 0x21 && Date.now() - T0 >= 7 * MIN) {
        board.restart()
        board.inputRegister = inputRegister
      }
      return value
    }
    await reader.run(10000)
    expect(board.writes).toEqual(['out13=true'])
    expect(board.outputs).toBe(1 << 13)
    // the power-up state is never published as the board's state
    expect(reader.reports('relays00-15').every((r) => r.outputs === 1 << 13)).toBe(true)
  })

  it('restores a command that failed while the board was down', async () => {
    const boards = {[RELAYS00]: fakeBoard(1 << 14), [RELAYS16]: fakeBoard()}
    const reader = startReader({boards})
    await reader.run(2000)
    boards[RELAYS00].up = false
    await reader.run(2000)
    await reader.command('relays00-15', {out14: false})
    expect(reader.logs.some((l) => l.startsWith('Error writing to device relays00-15'))).toBe(true)
    // the board comes up with out14 on, as its power-up state
    boards[RELAYS00].defaults = 1 << 14
    boards[RELAYS00].restart()
    boards[RELAYS00].up = true
    await reader.run(10000)
    expect(boards[RELAYS00].writes).toEqual(['out14=false'])
    expect(reader.logs.find((l) => l.includes('restarted'))).toMatch(/wrote out14=false \(last command\)$/)
    expect(boards[RELAYS00].outputs).toBe(0)
  })

  it('a board down for 5 minutes causes no port reopen, backs off to 60 s, and the input modules are polled all the time', async () => {
    const boards = {[RELAYS00]: fakeBoard(), [RELAYS16]: fakeBoard()}
    const reader = startReader({boards})
    await reader.run(2000)
    boards[RELAYS00].up = false
    await reader.run(5 * MIN)

    expect(reader.closes).toEqual([])
    expect(reader.logs.filter((l) => l.includes('Too many errors') || l.includes('Reconnecting'))).toEqual([])
    const tries = reader.requests(RELAYS00).filter((r) => r[0] >= 2000).map((r) => r[0])
    const gaps = tries.slice(1).map((t, i) => Math.round((t - tries[i]) / 1000))
    expect(gaps.slice(0, 7)).toEqual([1, 2, 4, 8, 16, 32, 60])
    expect(new Set(gaps.slice(6))).toEqual(new Set([60]))
    // each input module is read in every 100 ms of the 5 minutes
    for (const address of [DI1, DI2]) {
      const times = reader.requests(address).filter((r) => r[0] >= 2000).map((r) => r[0])
      const longest = Math.max(...times.slice(1).map((t, i) => t - times[i]))
      expect(longest).toBeLessThan(100)
    }
    expect(reader.logs.filter((l) => l.startsWith('relays00-15 does not answer'))).toHaveLength(tries.length)
  })

  it('the extra reads are about 1 short read per second per configured board, and none for a board with no restore config', async () => {
    const boards = {[RELAYS00]: fakeBoard(), [RELAYS16]: fakeBoard(), 3: fakeBoard()}
    const reader = startReader({config: CONFIG_PLAIN_RELAY, boards})
    await reader.run(5000)
    const from = 5000
    await reader.run(50000)
    const window = (address) => reader.requests(address).filter((r) => r[0] >= from && r[0] < from + 50000)

    const extra = [...window(RELAYS00), ...window(RELAYS16)]
    expect(extra.every((r) => r[2] === 'input' && r[3] === 0x20 && r[4] === 2)).toBe(true)
    // at most about 2 short reads per second for the two boards
    expect(extra.length).toBeLessThanOrEqual(2 * 50 + 2)
    expect(extra.length).toBeGreaterThanOrEqual(2 * 48)
    // relays32-47: its one full report at start, nothing in between
    expect(reader.requests(3)).toHaveLength(4)
    expect(reader.reports('relays16-31').filter((r) => r.at >= from)).toEqual([])
    expect(reader.reports('relays00-15').filter((r) => r.at >= from)).toEqual([])
  })
})
