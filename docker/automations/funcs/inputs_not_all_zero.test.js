const { describe, expect, test } = require('@jest/globals')
const create = require('./inputs_not_all_zero')

describe('inputs_not_all_zero', () => {
  test('drops 0 after a reading with several bits set, then passes the real value', () => {
    const filter = create()
    expect(filter({ inputs: 3157139 })).toBe(true)
    expect(filter({ inputs: 0 })).toBe(false)
    expect(filter({ inputs: 3157139 })).toBe(true)
  })

  test('passes 0 after a reading with one bit set: a real release', () => {
    const filter = create()
    expect(filter({ inputs: 1 << 31 >>> 0 })).toBe(true)
    expect(filter({ inputs: 0 })).toBe(true)
    expect(filter({ inputs: 1 << 4 })).toBe(true)
    expect(filter({ inputs: 0 })).toBe(true)
  })

  test('passes the first reading, even 0', () => {
    expect(create()({ inputs: 0 })).toBe(true)
  })

  test('keeps the last good reading per filter', () => {
    const a = create()
    const b = create()
    a({ inputs: 3 })
    expect(b({ inputs: 0 })).toBe(true)
    expect(a({ inputs: 0 })).toBe(false)
  })
})
