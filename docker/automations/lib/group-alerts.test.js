const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const {createBatch, sharedBatch} = require('./group-alerts')

describe('createBatch', () => {
  let sent

  beforeEach(() => {
    jest.useFakeTimers()
    sent = []
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('sends every name reported within the delay once, in one batch', () => {
    const report = createBatch({delayMs: 60000, send: (names) => sent.push(names)})

    report('roomA')
    jest.advanceTimersByTime(20000)
    report('roomB')
    report('roomA')
    expect(sent).toEqual([])

    jest.advanceTimersByTime(40000)
    expect(sent).toEqual([['roomA', 'roomB']])
  })

  it('starts a new batch after one was sent', () => {
    const report = createBatch({delayMs: 60000, send: (names) => sent.push(names)})

    report('roomA')
    jest.advanceTimersByTime(60000)
    report('roomB')
    jest.advanceTimersByTime(60000)

    expect(sent).toEqual([['roomA'], ['roomB']])
  })
})

describe('sharedBatch', () => {
  it('gives every caller with the same key the same batch', () => {
    const send = () => {}

    expect(sharedBatch('test:key', {send})).toBe(sharedBatch('test:key', {send}))
    expect(sharedBatch('test:other', {send})).not.toBe(sharedBatch('test:key', {send}))
  })
})
