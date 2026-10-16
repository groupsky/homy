import { describe, test, expect } from '@jest/globals'
import { maskId } from './secrets.js'

describe('maskId', () => {
  test('keeps only the last 3 characters', () => {
    expect(maskId('-123456789')).toBe('***789')
  })

  test('hides a short id completely', () => {
    expect(maskId('123')).toBe('***')
    expect(maskId('')).toBe('***')
  })

  test('accepts a number', () => {
    expect(maskId(-1001234567)).toBe('***567')
  })
})
