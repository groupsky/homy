const {describe, expect, it, jest} = require('@jest/globals')
const {read} = require('./aspar-mod-16ro')

// A client that answers every read with zeros of the asked length.
const zeros = (_, length) => Promise.resolve({data: new Array(length).fill(0)})
const client = () => ({readHoldingRegisters: jest.fn(zeros), readInputRegisters: jest.fn(zeros)})

describe('read', () => {
  const config = {options: {maxMsBetweenReports: 60000}}

  it('skips the read while the last report is recent', async () => {
    const state = {}
    expect(await read(client(), config, state)).toBeDefined()

    const second = client()
    expect(await read(second, config, state)).toBeUndefined()
    expect(second.readHoldingRegisters).not.toHaveBeenCalled()
  })

  it('reads again after a failed read, so a retry is not skipped', async () => {
    const state = {}
    const failing = client()
    failing.readInputRegisters.mockRejectedValueOnce(Object.assign(new Error('Timed out'), {name: 'TransactionTimedOutError'}))
    await expect(read(failing, config, state)).rejects.toThrow('Timed out')

    expect(await read(client(), config, state)).toMatchObject({outputs: 0})
  })
})
