const {describe, expect, it, jest} = require('@jest/globals')
const {read, write} = require('./microsyst-sr04')

// A client that keeps holding registers in `registers` and answers every other
// read with zeros. Every call is kept in `calls`, in order, so a test can check
// exactly what reached the bus.
const fakeClient = (registers = {}) => {
  const calls = []
  const zeros = (length) => new Array(length).fill(0)
  const record = (method, answer = () => undefined) => jest.fn(async (...args) => {
    calls.push([method, ...args])
    return answer(...args)
  })
  return {
    calls,
    registers,
    readCoils: record('readCoils', (_, length) => ({data: zeros(length).map(Boolean)})),
    readDiscreteInputs: record('readDiscreteInputs', (_, length) => ({data: zeros(length).map(Boolean)})),
    readHoldingRegisters: record('readHoldingRegisters', (address, length) =>
      ({data: zeros(length).map((_, i) => registers[address + i] ?? 0)})),
    readInputRegisters: record('readInputRegisters', (_, length) => ({data: zeros(length)})),
    writeCoil: record('writeCoil'),
    writeCoils: record('writeCoils'),
    writeRegister: record('writeRegister', (address, value) => { registers[address] = value }),
    writeRegisters: record('writeRegisters'),
  }
}

const TIMER = {ss: 59, mm: 7, hh: 23, dayWeek: 6, day: 31, month: 12, year: 26}

describe('write', () => {
  it('writes the clock registers in BCD, seconds and minutes first, with FC06 only', async () => {
    // 1027: year 25 in the high byte, an undocumented 0xAB in the low byte
    const client = fakeClient({1027: 0x25AB})

    await write(client, {timer: TIMER}, {}, {})

    expect(client.calls).toEqual([
      ['readHoldingRegisters', 1027, 1],
      ['writeRegister', 1024, 0x5907], // ss 59, mm 07
      ['writeRegister', 1025, 0x2307], // hh 23, Saturday is stored as 7
      ['writeRegister', 1026, 0x3112], // day 31, month 12
      ['writeRegister', 1027, 0x26AB], // year 26, the low byte kept
    ])
  })

  it.each([
    ['the earliest values', {ss: 0, mm: 0, hh: 0, dayWeek: 0, day: 1, month: 1, year: 0}],
    ['the latest values', {ss: 59, mm: 59, hh: 23, dayWeek: 6, day: 31, month: 12, year: 99}],
    ['a live reading', {ss: 15, mm: 22, hh: 15, dayWeek: 2, day: 20, month: 10, year: 26}],
  ])('reads back what it wrote: %s', async (_, timer) => {
    const client = fakeClient({1027: 0x2500})

    await write(client, {timer}, {}, {})

    expect((await read(client, {}, {})).timer).toEqual(timer)
  })

  it('takes the metadata the automations add to every message', async () => {
    const client = fakeClient()

    await write(client, {timer: TIMER, _bot: {name: 'sync', type: 'sr04-sync-clock'}, _tz: 1792500000000}, {}, {})

    expect(client.writeRegister).toHaveBeenCalledTimes(4)
  })

  it('makes the next poll read the configuration again, and keeps the rest of the state', async () => {
    const communication = {address: 1, stopBits: 1, parity: 'none', baudRate: 9600, broadcast: false}
    const state = {configuration: {spT1: 60}, communication}

    await write(fakeClient(), {timer: TIMER}, {}, state)

    expect(state).toEqual({configuration: undefined, communication})
    expect(state.communication).toBe(communication)
  })

  it('keeps the configuration when a write fails', async () => {
    const client = fakeClient()
    client.writeRegister.mockRejectedValueOnce(new Error('Timed out'))
    const state = {configuration: {spT1: 60}}

    await expect(write(client, {timer: TIMER}, {}, state)).rejects.toThrow('Timed out')

    expect(state.configuration).toEqual({spT1: 60})
  })

  it('writes nothing when it cannot read the year register', async () => {
    const client = fakeClient()
    client.readHoldingRegisters.mockRejectedValueOnce(new Error('Timed out'))

    await expect(write(client, {timer: TIMER}, {}, {})).rejects.toThrow('Timed out')

    expect(client.writeRegister).not.toHaveBeenCalled()
  })

  describe('rejects any other message without a call to the device', () => {
    const without = (field) => {
      const timer = {...TIMER}
      delete timer[field]
      return {timer}
    }

    it.each([
      ['null', null],
      ['a string', 'timer'],
      ['an empty object', {}],
      ['a timer and a setting', {timer: TIMER, configuration: {spT1: 60}}],
      ['a timer and an output', {timer: TIMER, outputs: {p1: true}}],
      ['a setting', {configuration: {spT1: 60}}],
      ['a timer that is not an object', {timer: '2026-10-20 14:01:27'}],
      ['a timer that is an array', {timer: [59, 7, 23, 6, 31, 12, 26]}],
      ['a timer with another field', {timer: {...TIMER, ms: 0}}],
      ['a timer with a field every object has', {timer: {...TIMER, constructor: 0}}],
      ...['ss', 'mm', 'hh', 'dayWeek', 'day', 'month', 'year'].map((field) => [`no ${field}`, without(field)]),
      ['a fraction', {timer: {...TIMER, ss: 1.5}}],
      ['a string number', {timer: {...TIMER, mm: '7'}}],
      ['a null field', {timer: {...TIMER, hh: null}}],
      ['NaN', {timer: {...TIMER, day: NaN}}],
      ['ss 60', {timer: {...TIMER, ss: 60}}],
      ['ss -1', {timer: {...TIMER, ss: -1}}],
      ['mm 60', {timer: {...TIMER, mm: 60}}],
      ['hh 24', {timer: {...TIMER, hh: 24}}],
      ['dayWeek 7', {timer: {...TIMER, dayWeek: 7}}],
      ['dayWeek -1', {timer: {...TIMER, dayWeek: -1}}],
      ['day 0', {timer: {...TIMER, day: 0}}],
      ['day 32', {timer: {...TIMER, day: 32}}],
      ['month 0', {timer: {...TIMER, month: 0}}],
      ['month 13', {timer: {...TIMER, month: 13}}],
      ['year 100', {timer: {...TIMER, year: 100}}],
      ['a four-digit year', {timer: {...TIMER, year: 2026}}],
    ])('%s', async (_, message) => {
      const client = fakeClient()
      const state = {configuration: {spT1: 60}}

      await expect(write(client, message, {}, state)).rejects.toThrow()

      expect(client.calls).toEqual([])
      expect(state.configuration).toEqual({spT1: 60})
    })
  })
})
