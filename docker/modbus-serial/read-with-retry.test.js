const {describe, expect, it, jest} = require('@jest/globals')
const readWithRetry = require('./read-with-retry')

// The same error shapes modbus-serial produces.
const timeout = () => Object.assign(new Error('Timed out'), {name: 'TransactionTimedOutError', errno: 'ETIMEDOUT'})
const crc = () => new Error('CRC error')
const exception4 = () => Object.assign(new Error('Modbus exception 4: Slave device failure'), {modbusCode: 4})
const portClosed = () => Object.assign(new Error('Port Not Open'), {name: 'PortNotOpenError'})

describe('readWithRetry', () => {
  it('returns the first result and does not read again when the read succeeds', async () => {
    const read = jest.fn().mockResolvedValue({v: 1})

    await expect(readWithRetry(read)).resolves.toEqual({v: 1})
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a timeout', timeout],
    ['a CRC error', crc],
  ])('reads once more after %s, after the pause', async (_, error) => {
    const read = jest.fn().mockRejectedValueOnce(error()).mockResolvedValueOnce({v: 2})
    const onRetry = jest.fn()

    const started = Date.now()
    await expect(readWithRetry(read, {msRetryDelay: 30, onRetry})).resolves.toEqual({v: 2})

    expect(read).toHaveBeenCalledTimes(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries only once and throws the second error', async () => {
    const second = timeout()
    const read = jest.fn().mockRejectedValueOnce(timeout()).mockRejectedValueOnce(second)

    await expect(readWithRetry(read, {msRetryDelay: 0})).rejects.toBe(second)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a Modbus exception from the device', exception4],
    ['a closed port', portClosed],
  ])('does not retry after %s', async (_, error) => {
    const err = error()
    const read = jest.fn().mockRejectedValue(err)

    await expect(readWithRetry(read, {msRetryDelay: 0})).rejects.toBe(err)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
