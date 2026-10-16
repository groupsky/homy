const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const {watchInputAge, DEFAULT_MAX_INPUT_AGE_MS} = require('./input-age')

const MIN = 60 * 1000

describe('watchInputAge', () => {
  let changes
  let watch

  beforeEach(() => {
    jest.useFakeTimers()
    changes = []
    watch = watchInputAge({inputs: ['a', 'b'], onChange: (stale) => changes.push(stale)})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('has a 10 minute limit by default', () => {
    expect(DEFAULT_MAX_INPUT_AGE_MS).toBe(10 * MIN)
  })

  it('is not fresh before every input was seen since the start', () => {
    watch.seen('a')

    expect(watch.isFresh()).toBe(false)
    watch.seen('b')
    expect(watch.isFresh()).toBe(true)
  })

  it('does not report stale at the start, only after the limit without data', () => {
    expect(watch.isStale()).toBe(false)

    jest.advanceTimersByTime(10 * MIN)
    expect(changes).toEqual([])

    jest.advanceTimersByTime(1 * MIN)
    expect(changes).toEqual([true])
  })

  it('reports stale once when one input stops, and fresh once when it returns', () => {
    watch.seen('a')
    watch.seen('b')
    for (let i = 0; i < 30; i++) {
      jest.advanceTimersByTime(1 * MIN)
      watch.seen('a')
    }

    expect(changes).toEqual([true])
    expect(watch.isStale()).toBe(true)
    expect(watch.isFresh()).toBe(false)

    watch.seen('b')
    watch.seen('b')
    jest.advanceTimersByTime(5 * MIN)

    expect(changes).toEqual([true, false])
    expect(watch.isFresh()).toBe(true)
  })

  it('counts an input from the time it was made, when given', () => {
    watch.seen('a', Date.now() - 30 * MIN)
    watch.seen('b')

    expect(watch.isStale()).toBe(true)
    expect(watch.isFresh()).toBe(false)
    expect(changes).toEqual([true])
  })

  it('takes the limit from maxAgeMs', () => {
    const short = []
    const w = watchInputAge({inputs: ['a'], maxAgeMs: 2 * MIN, onChange: (stale) => short.push(stale)})
    w.seen('a')

    jest.advanceTimersByTime(3 * MIN)

    expect(short).toEqual([true])
  })
})
