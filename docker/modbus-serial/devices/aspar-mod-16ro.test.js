const {describe, expect, it, jest} = require('@jest/globals')
const {read} = require('./aspar-mod-16ro')

// A client that answers every read with zeros of the asked length.
const zeros = (_, length) => Promise.resolve({data: new Array(length).fill(0)})
const client = () => ({readHoldingRegisters: jest.fn(zeros), readInputRegisters: jest.fn(zeros)})
const timeout = () => Object.assign(new Error('Timed out'), {name: 'TransactionTimedOutError'})

describe('read', () => {
  const config = {options: {maxMsBetweenReports: 60000}}

  it('skips the read while the last report is recent', async () => {
    const state = {}
    expect(await read(client(), config, state)).toBeDefined()

    const second = client()
    expect(await read(second, config, state)).toBeUndefined()
    expect(second.readHoldingRegisters).not.toHaveBeenCalled()
  })

  it('waits for the next report after a failed read, so a dead module is not read on every poll', async () => {
    const state = {}
    const failing = client()
    failing.readInputRegisters.mockRejectedValueOnce(timeout())
    await expect(read(failing, config, state)).rejects.toThrow('Timed out')

    expect(await read(client(), config, state)).toBeUndefined()
  })

  it('reads at once with force, which the retry after a failed read uses', async () => {
    const state = {}
    const failing = client()
    failing.readInputRegisters.mockRejectedValueOnce(timeout())
    await expect(read(failing, config, state)).rejects.toThrow('Timed out')

    expect(await read(client(), config, state, true)).toMatchObject({outputs: 0})
  })
})

/**
 * Output restore after a board restart (#2008). A fake MOD-16RO: its
 * received-packets counter (input registers 0x20-0x21) counts every request,
 * register 0x33 holds the outputs, register 0x0C the power-up state (def*).
 * A restart sets the counter near 0 and the outputs to the power-up state.
 */
describe('restore after a board restart', () => {
  const {afterEach, beforeEach} = require('@jest/globals')
  const {write} = require('./aspar-mod-16ro')
  const T0 = Date.UTC(2026, 10, 25, 18, 0, 0)
  const MIN = 60 * 1000

  function fakeBoard ({counter = 50000, outputs = 0, defaults = 0} = {}) {
    const board = {counter, outputs, defaults, up: true, requests: [], writes: []}
    const answer = (request) => {
      board.requests.push(request)
      if (!board.up) throw timeout()
      board.counter = (board.counter + 1) >>> 0
    }
    const inputRegister = (r) => {
      if (r === 0x0C) return board.defaults
      if (r === 0x20) return board.counter & 0xFFFF
      if (r === 0x21) return board.counter >>> 16
      if (r === 0x33) return board.outputs
      return 0
    }
    board.client = {
      readHoldingRegisters: jest.fn(async (addr, len) => {
        answer(['holding', addr, len])
        return {data: new Array(len).fill(0)}
      }),
      readInputRegisters: jest.fn(async (addr, len) => {
        answer(['input', addr, len])
        return {data: Array.from({length: len}, (_, i) => inputRegister(addr + i))}
      }),
      writeCoil: jest.fn(async (addr, value) => {
        answer(['coil', addr, value])
        board.writes.push([addr, value])
        const bit = addr & 0x0F
        const word = (addr & 0xFF0) === 0x330 ? 'outputs' : 'defaults'
        board[word] = value ? board[word] | (1 << bit) : board[word] & ~(1 << bit)
      }),
    }
    board.restart = () => {
      board.counter = 3
      board.outputs = board.defaults
    }
    return board
  }

  // relays00-15 as in config/modbus-serial/dry-switches.js, with one override
  const restoreConfig = (restore = {}) => ({
    name: 'relays00-15',
    options: {
      maxMsBetweenReports: 7 * MIN,
      restore: {
        restoreWithinMs: 15 * MIN,
        defaultState: false,
        outputs: {out8: {}, out9: {}, out10: {}, out11: {}, out13: {}, out14: {}, out15: {}},
        ...restore,
      },
    },
  })

  // Calls read() the way the poll loop does, every `step` ms, and keeps what
  // it returns (what index.js publishes).
  async function poll (board, config, state, ms, step = 20) {
    const reports = []
    for (let t = 0; t < ms; t += step) {
      const report = await read(board.client, config, state)
      if (report) reports.push({at: Date.now() - T0, ...report})
      await jest.advanceTimersByTimeAsync(step)
    }
    return reports
  }

  let logs
  beforeEach(() => {
    jest.useFakeTimers({now: T0})
    logs = []
    jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')))
    jest.spyOn(console, 'error').mockImplementation((...args) => logs.push(args.join(' ')))
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const outputWrites = (board) => board.writes.filter(([addr]) => addr >= 0x330)
    .map(([addr, value]) => `out${addr - 0x330}=${value}`)

  it('notices a restart within about 1 s and writes back the wanted outputs, then reports', async () => {
    // out9, out13 (lights) and out14 (boiler contactor) on; out3 has no config
    const board = fakeBoard({outputs: (1 << 9) | (1 << 13) | (1 << 14) | (1 << 3)})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 5000)
    board.restart()
    const restartAt = Date.now() - T0
    const reports = await poll(board, config, state, 3000)

    expect(reports).toHaveLength(1)
    expect(reports[0].at - restartAt).toBeLessThanOrEqual(1100)
    expect(reports[0].outputs).toBe((1 << 9) | (1 << 13) | (1 << 14))
    expect(outputWrites(board)).toEqual(['out9=true', 'out13=true', 'out14=true'])
    const restoreLog = logs.filter((l) => l.includes('restart'))
    expect(restoreLog).toHaveLength(1)
    expect(restoreLog[0]).toMatch(/^relays00-15 restarted/)
    expect(restoreLog[0]).toContain('out9=true')
    expect(restoreLog[0]).toContain('out14=true')
  })

  it('reads 0x33 and writes all outputs in one call, and the report follows at once', async () => {
    const board = fakeBoard({outputs: 1 << 9})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    board.restart()
    board.requests.length = 0
    await jest.advanceTimersByTimeAsync(1000)
    const report = await read(board.client, config, state)
    expect(report.outputs).toBe(1 << 9)
    expect(board.requests.slice(0, 3)).toEqual([
      ['input', 0x20, 2],
      ['input', 0x33, 1],
      ['coil', 0x339, true],
    ])
  })

  it('writes defaultState when the board was gone longer than restoreWithinMs, and never an output with no config', async () => {
    // out9 and out14 on; out3 and out12 have no config, out13 is set to come
    // up on at power-up, so it differs from its defaultState too
    const board = fakeBoard({outputs: (1 << 9) | (1 << 14) | (1 << 3) | (1 << 12)})
    const config = restoreConfig({outputs: {out9: {}, out13: {}, out14: {}, out15: {defaultState: true}}})
    const state = {}
    await poll(board, config, state, 2000)
    board.up = false
    await poll(board, config, state, 20 * MIN, 200)
    board.defaults = (1 << 3) | (1 << 13)
    board.restart()
    board.up = true
    const reports = await poll(board, config, state, 61 * 1000, 200)

    expect(outputWrites(board).sort()).toEqual(['out13=false', 'out15=true'])
    expect(reports[0].outputs).toBe((1 << 3) | (1 << 15))
    expect(logs.find((l) => l.includes('restarted'))).toMatch(/gone longer than 900000 ms/)
  })

  it('leaves an output as the board came up when it was gone too long and has no defaultState', async () => {
    const board = fakeBoard({outputs: 1 << 9})
    const config = restoreConfig({defaultState: undefined})
    const state = {}
    await poll(board, config, state, 2000)
    board.up = false
    await poll(board, config, state, 16 * MIN, 500)
    board.restart()
    board.up = true
    await poll(board, config, state, 61 * 1000, 200)
    expect(outputWrites(board)).toEqual([])
  })

  it('restores a command that failed while the board was down, not the older report', async () => {
    const board = fakeBoard({outputs: (1 << 14) | (1 << 9)})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    board.up = false
    await poll(board, config, state, 3000)
    await expect(write(board.client, {out14: false}, config, state)).rejects.toThrow('Timed out')
    await expect(write(board.client, {out11: true}, config, state)).rejects.toThrow('Timed out')
    // the board comes up with every output on (to show out14 is written off)
    board.defaults = 0xFFFF
    board.restart()
    board.up = true
    const reports = await poll(board, config, state, 61 * 1000, 100)

    expect(outputWrites(board).sort()).toEqual(['out10=false', 'out13=false', 'out14=false', 'out15=false', 'out8=false'])
    expect(reports[0].outputs & 0xFF00).toBe((1 << 9) | (1 << 11) | (1 << 12))
  })

  it('a command before the last report does not count: the report wins', async () => {
    const board = fakeBoard({outputs: 0})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    await write(board.client, {out9: true}, config, state)
    await poll(board, config, state, 100)
    // someone turned out9 off by hand, seen in the next full report
    board.outputs = 0
    await jest.advanceTimersByTimeAsync(7 * MIN)
    await poll(board, config, state, 100)
    board.restart()
    board.outputs = 1 << 9
    await poll(board, config, state, 2000)
    expect(outputWrites(board)).toEqual(['out9=true', 'out9=false'])
  })

  it('backs off a board that does not answer: 1, 2, 4 ... 60 s, and does not throw', async () => {
    const board = fakeBoard()
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    board.up = false
    board.requests.length = 0
    const tries = []
    board.client.readInputRegisters.mockImplementation(async () => {
      tries.push(Date.now() - T0)
      throw timeout()
    })
    await poll(board, config, state, 5 * MIN, 50)
    const gaps = tries.slice(1).map((t, i) => Math.round((t - tries[i]) / 1000))
    expect(gaps.slice(0, 7)).toEqual([1, 2, 4, 8, 16, 32, 60])
    expect(new Set(gaps.slice(6))).toEqual(new Set([60]))
  })

  it('the 1 s counter read publishes nothing and reads only 2 registers when there is no restart', async () => {
    const board = fakeBoard({outputs: 1 << 9})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 100)
    board.requests.length = 0
    const reports = await poll(board, config, state, 60 * 1000)
    expect(reports).toEqual([])
    expect(board.requests.length).toBeGreaterThanOrEqual(59)
    expect(board.requests.length).toBeLessThanOrEqual(61)
    expect(new Set(board.requests.map((r) => r.join()))).toEqual(new Set(['input,32,2']))
    expect(board.writes).toEqual([])
  })

  it('a counter overflow with matching outputs writes nothing', async () => {
    const board = fakeBoard({counter: 0xFFFFFFF0, outputs: 1 << 9})
    const config = restoreConfig()
    const state = {}
    const reports = await poll(board, config, state, 30 * 1000)
    expect(board.counter).toBeLessThan(100)
    expect(board.writes).toEqual([])
    expect(reports.map((r) => r.outputs)).toEqual([1 << 9, 1 << 9])
    expect(logs.find((l) => l.includes('restarted'))).toMatch(/nothing to write/)
  })

  it('at start writes only the def* coils that differ from the config', async () => {
    // def9 and def13 on; def3 on but out3 has no config; out15 should be on
    const board = fakeBoard({defaults: (1 << 9) | (1 << 13) | (1 << 3)})
    const config = restoreConfig({outputs: {out9: {}, out13: {defaultState: true}, out14: {}, out15: {defaultState: true}}})
    const state = {}
    const reports = await poll(board, config, state, 8 * MIN, 1000)
    expect(board.writes.map(([addr, value]) => `def${addr - 0x0C0}=${value}`).sort()).toEqual(['def15=true', 'def9=false'])
    expect(reports[0].defaultOutputState).toBe((1 << 3) | (1 << 13) | (1 << 15))
    expect(logs.filter((l) => l.includes('power-up state'))).toHaveLength(2)
    expect(reports).toHaveLength(2)
  })

  it('at start writes no def* coil when they match the config', async () => {
    const board = fakeBoard({defaults: 0})
    const state = {}
    await poll(board, restoreConfig(), state, 8 * MIN, 1000)
    expect(board.writes).toEqual([])
  })

  it('sends the report after a restore even when its first read fails', async () => {
    const board = fakeBoard({outputs: 1 << 9})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    board.restart()
    const holding = board.client.readHoldingRegisters
    holding.mockImplementationOnce(async () => { throw timeout() })
    const reports = await poll(board, config, state, 5000)
    expect(outputWrites(board)).toEqual(['out9=true'])
    expect(reports).toHaveLength(1)
    expect(reports[0].outputs).toBe(1 << 9)
  })

  it('a failed def* write does not stop the report and is tried again at the next full report', async () => {
    const board = fakeBoard({defaults: 1 << 9})
    const config = restoreConfig()
    const state = {}
    board.client.writeCoil.mockImplementationOnce(async () => { throw timeout() })
    const reports = await poll(board, config, state, 8 * MIN, 1000)
    expect(reports).toHaveLength(2)
    expect(reports[0].defaultOutputState).toBe(1 << 9)
    expect(reports[1].defaultOutputState).toBe(0)
    expect(logs.some((l) => l.startsWith('relays00-15 could not set the power-up state'))).toBe(true)
  })

  it('notices a second restart during the report after a restore', async () => {
    const board = fakeBoard({outputs: (1 << 9) | (1 << 13)})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    board.restart()
    // the board restarts again on the first read of the report
    board.client.readHoldingRegisters.mockImplementationOnce(async () => {
      board.restart()
      throw timeout()
    })
    const reports = await poll(board, config, state, 5000)
    expect(outputWrites(board)).toEqual(['out9=true', 'out13=true', 'out9=true', 'out13=true'])
    expect(reports.at(-1).outputs).toBe((1 << 9) | (1 << 13))
  })

  it('a successful write ends the back-off, so a restart is found at the next poll', async () => {
    const board = fakeBoard({outputs: 1 << 9})
    const config = restoreConfig()
    const state = {}
    await poll(board, config, state, 2000)
    board.up = false
    await poll(board, config, state, 40 * 1000, 100)
    board.restart()
    board.up = true
    await write(board.client, {out14: true}, config, state)
    const reports = await poll(board, config, state, 200)
    expect(outputWrites(board)).toEqual(['out14=true', 'out9=true'])
    expect(reports[0].outputs).toBe((1 << 9) | (1 << 14))
  })

  it('a board with no restore config gets no extra reads', async () => {
    const board = fakeBoard()
    const state = {}
    await poll(board, {options: {maxMsBetweenReports: 7 * MIN}}, state, 60 * 1000)
    // one full report: 1 holding and 3 input register reads
    expect(board.requests).toHaveLength(4)
  })

  it('rejects an unknown output name in the config', async () => {
    const board = fakeBoard()
    await expect(read(board.client, restoreConfig({outputs: {out16: {}}}), {})).rejects.toThrow(/out16/)
  })
})
