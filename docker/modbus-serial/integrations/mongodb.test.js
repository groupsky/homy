const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')

jest.mock('mongodb')
const {MongoClient} = require('mongodb')
const createMongoIntegration = require('./mongodb')

describe('mongodb integration', () => {
  let inserted

  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    inserted = []
    const collection = {insertOne: jest.fn(async (doc) => { inserted.push(doc) })}
    MongoClient.connect = jest.fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED mongo:27017'))
      .mockResolvedValue({db: () => ({collection: () => collection})})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // At boot the reader may start before Mongo is up (#1709).
  it('starts writing once a later connect works', async () => {
    const {publish} = createMongoIntegration({url: 'mongodb://mongo/homy', collection: 'inverter'})
    await jest.advanceTimersByTimeAsync(0)
    publish({v: 1})

    await jest.advanceTimersByTimeAsync(10000)
    publish({v: 2})

    expect(MongoClient.connect).toHaveBeenCalledTimes(2)
    expect(inserted).toEqual([{v: 2}])
  })
})
