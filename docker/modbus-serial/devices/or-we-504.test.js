const {describe, expect, it, jest} = require('@jest/globals')
const {read, setup} = require('./or-we-504')

// Fixtures marked [datasheet] are taken from the worked examples in the OR-WE-504 register
// documentation. The rest are constructed to exercise scaling and are not device captures.
describe('read', () => {
  it('should read instantaneous parameters', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
      data: [
        // [datasheet] voltage - 225.9V - uint16 in V*10
        0x08D3,
        // [datasheet] current - 1.9A - uint16 in A*10
        0x0013,
        // frequency - 50.1Hz - uint16 in Hz*10
        0x01F5,
        // active power - 407W - uint16 in W (225.9V * 1.9A * 0.949)
        0x0197,
        // reactive power - 135VAr - uint16 in VAr
        0x0087,
        // apparent power - 429VA - uint16 in VA (225.9V * 1.9A)
        0x01AD,
        // power factor - 0.949 - uint16 in factor*1000
        0x03B5,
      ]
    })

    expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
      {read: {instantaneous: true, energy: false, config: false}}
    )).toEqual({
      v: 225.9,
      c: 1.9,
      freq: 50.1,
      p: 407,
      rp: 135,
      ap: 429,
      pow: 0.949,
    })
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
    expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x00, 7)
  })

  it('should read energy parameters', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
      data: [
        // [datasheet] active energy - 3795Wh - uint32 in Wh, high word first
        0x0000, 0x0ED3,
        // reactive energy - 70011VArh - uint32 in VArh, high word first
        // NOTE: word order is not pinned by any datasheet example (the only one has a zero
        // high word) and the register table labels these both "Big Endian (ABCD)" and
        // "Swapped long" - confirm against hardware before trusting the energy totals
        0x0001, 0x117B,
      ]
    })

    expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
      {read: {instantaneous: false, energy: true, config: false}}
    )).toEqual({
      tot_act: 3.795,
      tot_react: 70.011,
    })
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
    expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x07, 4)
  })

  it('should read energy counters beyond 16 bits', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
      data: [
        // active energy - 123456789Wh
        0x075B, 0xCD15,
        // reactive energy - 0Wh
        0x0000, 0x0000,
      ]
    })

    expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
      {read: {instantaneous: false, energy: true, config: false}}
    )).toEqual({
      tot_act: 123456.789,
      tot_react: 0,
    })
  })

  it('should read configuration parameters', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
      data: [
        // baud rate - 9600
        0x0004,
        // modbus address
        0x0002,
      ]
    })

    expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
      {read: {instantaneous: false, energy: false, config: true}}
    )).toEqual({
      baud_rate: 9600,
      id: 2,
    })
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
    expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x0E, 2)
  })

  it('should read instantaneous and energy by default', async () => {
    const mockReadHoldingRegisters = jest.fn()
      .mockResolvedValueOnce({data: [0x08D3, 0x0013, 0x01F5, 0x0197, 0x0087, 0x01AD, 0x03B5]})
      .mockResolvedValueOnce({data: [0x0000, 0x0ED3, 0x0000, 0x0000]})

    const result = await read({readHoldingRegisters: mockReadHoldingRegisters})

    expect(result).toEqual({
      v: 225.9,
      c: 1.9,
      freq: 50.1,
      p: 407,
      rp: 135,
      ap: 429,
      pow: 0.949,
      tot_act: 3.795,
      tot_react: 0,
    })
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(2)
  })

  it('should skip reporting unchanged values within the report interval', async () => {
    const data = {data: [0x0000, 0x0ED3, 0x0000, 0x0000]}
    const mockReadHoldingRegisters = jest.fn().mockResolvedValue(data)
    const client = {readHoldingRegisters: mockReadHoldingRegisters}
    const config = {
      read: {instantaneous: false, energy: true, config: false},
      options: {maxMsBetweenReports: 60000},
    }
    const state = {}

    expect(await read(client, config, state)).toEqual({tot_act: 3.795, tot_react: 0})
    expect(await read(client, config, state)).toBeUndefined()
  })

  it('should skip reporting unchanged instantaneous values', async () => {
    const mockReadHoldingRegisters = jest.fn()
      .mockResolvedValue({data: [0x08D3, 0x0013, 0x01F5, 0x0197, 0x0087, 0x01AD, 0x03B5]})
    const client = {readHoldingRegisters: mockReadHoldingRegisters}
    const config = {
      read: {instantaneous: true, energy: false, config: false},
      options: {maxMsBetweenReports: 60000},
    }
    const state = {}

    expect(await read(client, config, state)).toEqual({
      v: 225.9, c: 1.9, freq: 50.1, p: 407, rp: 135, ap: 429, pow: 0.949,
    })
    expect(await read(client, config, state)).toBeUndefined()
  })

  it('should skip reporting unchanged config values', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValue({data: [0x0004, 0x0002]})
    const client = {readHoldingRegisters: mockReadHoldingRegisters}
    const config = {
      read: {instantaneous: false, energy: false, config: true},
      options: {maxMsBetweenReports: 60000},
    }
    const state = {}

    expect(await read(client, config, state)).toEqual({baud_rate: 9600, id: 2})
    expect(await read(client, config, state)).toBeUndefined()
  })

  it('should report unchanged values again once the report interval elapses', async () => {
    jest.useFakeTimers()
    try {
      const mockReadHoldingRegisters = jest.fn().mockResolvedValue({data: [0x0000, 0x0ED3, 0x0000, 0x0000]})
      const client = {readHoldingRegisters: mockReadHoldingRegisters}
      const config = {
        read: {instantaneous: false, energy: true, config: false},
        options: {maxMsBetweenReports: 60000},
      }
      const state = {}

      expect(await read(client, config, state)).toBeDefined()
      expect(await read(client, config, state)).toBeUndefined()

      jest.advanceTimersByTime(60001)

      expect(await read(client, config, state)).toEqual({tot_act: 3.795, tot_react: 0})
    } finally {
      jest.useRealTimers()
    }
  })

  // maxMsBetweenReports 0 disables the periodic forced report, matching or-we-514/or-we-526
  it('should never re-report unchanged values when maxMsBetweenReports is 0', async () => {
    jest.useFakeTimers()
    try {
      const mockReadHoldingRegisters = jest.fn().mockResolvedValue({data: [0x0000, 0x0ED3, 0x0000, 0x0000]})
      const client = {readHoldingRegisters: mockReadHoldingRegisters}
      const config = {
        read: {instantaneous: false, energy: true, config: false},
        options: {maxMsBetweenReports: 0},
      }
      const state = {}

      expect(await read(client, config, state)).toEqual({tot_act: 3.795, tot_react: 0})
      expect(await read(client, config, state)).toBeUndefined()

      jest.advanceTimersByTime(3600000)

      expect(await read(client, config, state)).toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })

  it('should drop garbage frames reporting no voltage and no grid frequency', async () => {
    const mockReadHoldingRegisters = jest.fn()
      .mockResolvedValueOnce({data: [0x08D3, 0x0013, 0x01F5, 0x0197, 0x0087, 0x01AD, 0x03B5]})
      .mockResolvedValueOnce({data: [0x0000, 0x0ED3, 0x0000, 0x0000]})
      .mockResolvedValueOnce({data: [0, 0, 0, 0, 0, 0, 0]})
    const client = {readHoldingRegisters: mockReadHoldingRegisters}
    const state = {}
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await read(client, undefined, state)).toEqual(expect.objectContaining({tot_act: 3.795}))
    // the garbage frame must not be published, and must not clobber the last good values
    expect(await read(client, undefined, state)).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    expect(state).toEqual(expect.objectContaining({v: 225.9, tot_act: 3.795}))
    // the energy registers are not even read once the frame is known to be garbage
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(3)
  })

  it('should propagate read errors and leave state untouched', async () => {
    const error = new Error('Timed out')
    const mockReadHoldingRegisters = jest.fn()
      .mockResolvedValueOnce({data: [0x08D3, 0x0013, 0x01F5, 0x0197, 0x0087, 0x01AD, 0x03B5]})
      .mockRejectedValueOnce(error)
    const state = {}

    await expect(read({readHoldingRegisters: mockReadHoldingRegisters}, undefined, state))
      .rejects.toThrow(error)
    expect(state).toEqual({})
  })

  it('should report changed values within the report interval', async () => {
    const mockReadHoldingRegisters = jest.fn()
      .mockResolvedValueOnce({data: [0x0000, 0x0ED3, 0x0000, 0x0000]})
      .mockResolvedValueOnce({data: [0x0000, 0x0ED4, 0x0000, 0x0000]})
    const client = {readHoldingRegisters: mockReadHoldingRegisters}
    const config = {
      read: {instantaneous: false, energy: true, config: false},
      options: {maxMsBetweenReports: 60000},
    }
    const state = {}

    expect(await read(client, config, state)).toEqual({tot_act: 3.795, tot_react: 0})
    expect(await read(client, config, state)).toEqual({tot_act: 3.796, tot_react: 0})
  })
})

describe('setup', () => {
  const timeout = () => Object.assign(new Error('Timed out'), {errno: 'ETIMEDOUT'})

  const mockClient = (overrides = {}) => ({
    // RTUBufferedPort drops the FC 0x28 reply, so the unlock always times out
    customFunction: jest.fn().mockRejectedValue(timeout()),
    writeRegisters: jest.fn().mockResolvedValue({}),
    readHoldingRegisters: jest.fn().mockResolvedValue({data: [2]}),
    setID: jest.fn(),
    getTimeout: jest.fn().mockReturnValue(1000),
    setTimeout: jest.fn(),
    ...overrides,
  })

  it('should not touch the meter when given nothing to change', async () => {
    const client = mockClient()

    await setup(client, {})

    expect(client.customFunction).not.toHaveBeenCalled()
    expect(client.writeRegisters).not.toHaveBeenCalled()
  })

  it('should unlock with the factory password before writing', async () => {
    const client = mockClient()

    await setup(client, {baudRate: 4800})

    // datasheet: 01 28 FE 01 00 02 04 00 00 00 00
    expect(client.customFunction).toHaveBeenCalledWith(0x28,
      [0xFE, 0x01, 0x00, 0x02, 0x04, 0x00, 0x00, 0x00, 0x00])
    expect(client.customFunction.mock.invocationCallOrder[0])
      .toBeLessThan(client.writeRegisters.mock.invocationCallOrder[0])
  })

  it('should unlock with the given password', async () => {
    const client = mockClient()

    await setup(client, {baudRate: 4800, password: '12345678'})

    expect(client.customFunction).toHaveBeenCalledWith(0x28,
      [0xFE, 0x01, 0x00, 0x02, 0x04, 0x12, 0x34, 0x56, 0x78])
  })

  it('should propagate unlock failures other than the expected timeout', async () => {
    const client = mockClient({
      customFunction: jest.fn().mockRejectedValue(new Error('Port Not Open')),
    })

    await expect(setup(client, {baudRate: 4800})).rejects.toThrow('Port Not Open')
    expect(client.writeRegisters).not.toHaveBeenCalled()
  })

  it('should write baud rate', async () => {
    const client = mockClient()

    await setup(client, {baudRate: 4800})

    expect(client.writeRegisters).toHaveBeenCalledWith(0x0E, [3])
  })

  it('should reject an unsupported baud rate before unlocking the meter', async () => {
    const client = mockClient()

    await expect(setup(client, {baudRate: 19200})).rejects.toThrow('Unsupported baud rate 19200')
    expect(client.customFunction).not.toHaveBeenCalled()
    expect(client.writeRegisters).not.toHaveBeenCalled()
  })

  it('should cap the client timeout while unlocking and restore it after', async () => {
    const client = mockClient({getTimeout: jest.fn().mockReturnValue(10000)})

    await setup(client, {baudRate: 4800})

    expect(client.setTimeout).toHaveBeenNthCalledWith(1, 500)
    expect(client.setTimeout).toHaveBeenNthCalledWith(2, 10000)
  })

  it('should write the baud rate after the address', async () => {
    const client = mockClient()

    await setup(client, {address: 2, baudRate: 4800})

    const addressWrite = client.writeRegisters.mock.calls.findIndex(([reg]) => reg === 0x0F)
    const baudWrite = client.writeRegisters.mock.calls.findIndex(([reg]) => reg === 0x0E)
    expect(addressWrite).toBeLessThan(baudWrite)
  })

  it('should write a new password as 4 BCD digits per register', async () => {
    const client = mockClient()

    // datasheet: 02 10 00 10 00 02 04 11 11 11 11 -> password 11111111
    await setup(client, {newPassword: '11111111'})

    expect(client.writeRegisters).toHaveBeenCalledWith(0x10, [0x1111, 0x1111])
  })

  it('should reject a password that is not exactly 8 digits before unlocking', async () => {
    const client = mockClient()

    await expect(setup(client, {newPassword: '1234'}))
      .rejects.toThrow('Password must be exactly 8 digits')
    expect(client.customFunction).not.toHaveBeenCalled()
    expect(client.writeRegisters).not.toHaveBeenCalled()
  })

  it('should write password, then address, then baud rate', async () => {
    const client = mockClient()

    await setup(client, {address: 2, baudRate: 9600, newPassword: '11111111'})

    expect(client.writeRegisters).toHaveBeenNthCalledWith(1, 0x10, [0x1111, 0x1111])
    expect(client.writeRegisters).toHaveBeenNthCalledWith(2, 0x0F, [2])
    expect(client.writeRegisters).toHaveBeenNthCalledWith(3, 0x0E, [4])
    expect(client.setID).toHaveBeenCalledWith(2)
  })

  it('should switch the client to the new address when the address write times out', async () => {
    // the meter answers from its new unit id, which RTUBufferedPort drops - this timeout is
    // what the address write actually rejects with over the transport this repo uses
    const client = mockClient({
      writeRegisters: jest.fn().mockRejectedValueOnce(timeout()),
    })

    await setup(client, {address: 2})

    expect(client.setID).toHaveBeenCalledWith(2)
    expect(client.readHoldingRegisters).toHaveBeenCalledWith(0x0F, 1)
  })

  it('should switch the client to the new address on an unbuffered address mismatch', async () => {
    // an unbuffered or TCP transport reports the mismatch instead of timing out
    const client = mockClient({
      writeRegisters: jest.fn()
        .mockRejectedValueOnce(new Error('Unexpected data error, expected address 1 got 2')),
    })

    await setup(client, {address: 2})

    expect(client.setID).toHaveBeenCalledWith(2)
  })

  it('should not swallow an unexpected function code as an address change', async () => {
    // same message prefix, but a stale reply from another unit - the write did not succeed
    const client = mockClient({
      writeRegisters: jest.fn()
        .mockRejectedValueOnce(new Error('Unexpected data error, expected code 16 got 3')),
    })

    await expect(setup(client, {address: 2}))
      .rejects.toThrow('Unexpected data error, expected code 16 got 3')
    expect(client.setID).not.toHaveBeenCalled()
  })

  it('should fail when the meter did not take the new address', async () => {
    const client = mockClient({
      readHoldingRegisters: jest.fn().mockResolvedValue({data: [1]}),
    })

    await expect(setup(client, {address: 2}))
      .rejects.toThrow('Address change failed, meter reports address 1')
  })

  it('should propagate other address write failures', async () => {
    const client = mockClient({
      writeRegisters: jest.fn().mockRejectedValueOnce(new Error('Illegal data address')),
    })

    await expect(setup(client, {address: 2})).rejects.toThrow('Illegal data address')
    expect(client.setID).not.toHaveBeenCalled()
  })
})
