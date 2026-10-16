const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const {connectWithRetry} = require('./mongo-connect')

const refused = () => new Error('connect ECONNREFUSED mongo:27017')

describe('connectWithRetry', () => {
  let errors

  beforeEach(() => {
    jest.useFakeTimers()
    errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves with the client of the first connect that works', async () => {
    const client = {name: 'client'}
    const connect = jest.fn()
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValue(client)

    const connected = connectWithRetry({connect, retryMs: 10000})
    await jest.advanceTimersByTimeAsync(10000)
    expect(connect).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(10000)

    await expect(connected).resolves.toBe(client)
    expect(connect).toHaveBeenCalledTimes(3)
  })

  it('logs each failed attempt in one line with the error message', async () => {
    const connect = jest.fn().mockRejectedValueOnce(refused()).mockResolvedValue({})

    connectWithRetry({connect, retryMs: 10000})
    await jest.advanceTimersByTimeAsync(0)

    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0].join(' ')).toContain('ECONNREFUSED')
    expect(errors.mock.calls[0].join(' ')).toContain('retrying in 10 s')
  })

  it('does not connect again after it worked', async () => {
    const connect = jest.fn().mockResolvedValue({})

    await connectWithRetry({connect, retryMs: 10000})
    await jest.advanceTimersByTimeAsync(60000)

    expect(connect).toHaveBeenCalledTimes(1)
  })
})
