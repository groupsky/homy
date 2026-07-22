const {describe, expect, it, jest} = require('@jest/globals')
const {read, setup} = require('./or-we-504')

describe('read', () => {
  it('should read instantaneous parameters', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
      data: [
        // voltage - 225.9V - uint16 in V*10
        0x08D3,
        // current - 1.9A - uint16 in A*10
        0x0013,
        // frequency - 50.1Hz - uint16 in Hz*10
        0x01F5,
        // active power - 1234W - uint16 in W
        0x04D2,
        // reactive power - 345VAr - uint16 in VAr
        0x0159,
        // apparent power - 1300VA - uint16 in VA
        0x0514,
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
      p: 1234,
      rp: 345,
      ap: 1300,
      pow: 0.949,
    })
    expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
    expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x00, 7)
  })

  it('should read energy parameters', async () => {
    const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
      data: [
        // active energy - 3795Wh - uint32 in Wh, high word first
        0x0000, 0x0ED3,
        // reactive energy - 70011Wh - uint32 in VArh, high word first
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
      .mockResolvedValueOnce({data: [0x08D3, 0x0013, 0x01F5, 0x04D2, 0x0159, 0x0514, 0x03B5]})
      .mockResolvedValueOnce({data: [0x0000, 0x0ED3, 0x0000, 0x0000]})

    const result = await read({readHoldingRegisters: mockReadHoldingRegisters})

    expect(result).toEqual({
      v: 225.9,
      c: 1.9,
      freq: 50.1,
      p: 1234,
      rp: 345,
      ap: 1300,
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
  it('should unlock with the factory password when none given', async () => {
    const mockWriteRegisters = jest.fn().mockResolvedValue({})

    await setup({writeRegisters: mockWriteRegisters}, {})

    expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
    expect(mockWriteRegisters).toHaveBeenCalledWith(0x80, [0x0000, 0x0000, 0x0000, 0x0000])
  })

  it('should unlock with the given password', async () => {
    const mockWriteRegisters = jest.fn().mockResolvedValue({})

    await setup({writeRegisters: mockWriteRegisters}, {password: '12345678'})

    expect(mockWriteRegisters).toHaveBeenCalledWith(0x80, [0x0012, 0x0034, 0x0056, 0x0078])
  })

  it('should write baud rate', async () => {
    const mockWriteRegisters = jest.fn().mockResolvedValue({})

    await setup({writeRegisters: mockWriteRegisters}, {baudRate: 4800})

    expect(mockWriteRegisters).toHaveBeenCalledWith(0x0E, [3])
  })

  it('should write a new password', async () => {
    const mockWriteRegisters = jest.fn().mockResolvedValue({})

    await setup({writeRegisters: mockWriteRegisters}, {newPassword: '12345678'})

    expect(mockWriteRegisters).toHaveBeenCalledWith(0x40, [0x0012, 0x0034, 0x0056, 0x0078])
  })

  it('should write the address last and switch the client to it', async () => {
    const mockWriteRegisters = jest.fn().mockResolvedValue({})
    const mockSetID = jest.fn()

    await setup({writeRegisters: mockWriteRegisters, setID: mockSetID}, {address: 2, baudRate: 9600})

    expect(mockWriteRegisters).toHaveBeenNthCalledWith(1, 0x80, [0, 0, 0, 0])
    expect(mockWriteRegisters).toHaveBeenNthCalledWith(2, 0x0E, [4])
    expect(mockWriteRegisters).toHaveBeenNthCalledWith(3, 0x0F, [2])
    expect(mockSetID).toHaveBeenCalledWith(2)
  })
})
