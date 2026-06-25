const {describe, test, expect} = require('@jest/globals')
const contentProcessors = require('./content-processors')

describe('Content Processors', () => {

  describe('JSON content processor', () => {
    test('should add metadata to JSON payloads', () => {
      const payload = { state: true }
      const meta = {
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      }

      const result = contentProcessors.json.write(payload, meta)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual({
        state: true,
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      })
    })

    test('should handle empty payload with metadata', () => {
      const payload = {}
      const meta = {
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      }

      const result = contentProcessors.json.write(payload, meta)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual({
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      })
    })

    test('should work without metadata parameter (backward compatibility)', () => {
      const payload = { state: true }

      const result = contentProcessors.json.write(payload)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual({ state: true })
    })

    test('should preserve payload properties when adding metadata', () => {
      const payload = { state: true, value: 42, name: 'test' }
      const meta = {
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      }

      const result = contentProcessors.json.write(payload, meta)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual({
        state: true,
        value: 42,
        name: 'test',
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      })
    })
  })

  describe('Plain content processor', () => {
    test('should return plain string without metadata', () => {
      const payload = 'BgMjhxFgAi6gAQOdBi4CwAHgARUBLgJAF0ADQAFAB+AHA0ABQBPgAwHgBz9AAUAj4AsDBymcAyP0CC4C'
      const meta = {
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      }

      const result = contentProcessors.plain.write(payload, meta)

      expect(result).toBe('BgMjhxFgAi6gAQOdBi4CwAHgARUBLgJAF0ADQAFAB+AHA0ABQBPgAwHgBz9AAUAj4AsDBymcAyP0CC4C')
      expect(result).not.toContain('_bot')
      expect(result).not.toContain('_tz')
      expect(result).not.toContain('[object Object]')
    })

    test('should convert non-string payloads to strings', () => {
      const payload = 12345
      const meta = {
        _bot: { name: 'testBot', type: 'test-type' },
        _tz: 1234567890
      }

      const result = contentProcessors.plain.write(payload, meta)

      expect(result).toBe('12345')
    })

    test('should work without metadata parameter', () => {
      const payload = 'test-string'

      const result = contentProcessors.plain.write(payload)

      expect(result).toBe('test-string')
    })

    test('should handle IR codes correctly', () => {
      const irCode = 'Bj8jexFqAiQgAUAFA5QGJALgAwFAE0ABQBdAA0APQAfgDwOAAUAlASQCgAVAAUAJQAMEJAKUBmogA8AHQAuAAwcCnD8jjAhqAg=='
      const meta = {
        _bot: { name: 'tvControl', type: 'mqtt-transform' },
        _tz: Date.now()
      }

      const result = contentProcessors.plain.write(irCode, meta)

      expect(result).toBe(irCode)
      expect(typeof result).toBe('string')
    })

    test('should handle boolean to string conversion', () => {
      expect(contentProcessors.plain.write(true)).toBe('true')
      expect(contentProcessors.plain.write(false)).toBe('false')
    })

    test('should handle null and undefined', () => {
      expect(contentProcessors.plain.write(null)).toBe('null')
      expect(contentProcessors.plain.write(undefined)).toBe('undefined')
    })

    test('should read plain strings', () => {
      const input = 'test-string-123'
      const result = contentProcessors.plain.read(input)

      expect(result).toBe('test-string-123')
      expect(typeof result).toBe('string')
    })

    test('should convert non-string values when reading', () => {
      expect(contentProcessors.plain.read(123)).toBe('123')
      expect(contentProcessors.plain.read(true)).toBe('true')
    })
  })

  describe('JSON content processor', () => {
    test('should read JSON strings', () => {
      const jsonString = '{"state":true,"value":42}'
      const result = contentProcessors.json.read(jsonString)

      expect(result).toEqual({ state: true, value: 42 })
    })

    test('should throw on invalid JSON', () => {
      expect(() => {
        contentProcessors.json.read('not valid json')
      }).toThrow()
    })

    test('should handle complex nested objects', () => {
      const payload = {
        state: true,
        nested: { a: 1, b: 2 },
        array: [1, 2, 3]
      }
      const meta = { _bot: { name: 'test' }, _tz: 123 }

      const result = contentProcessors.json.write(payload, meta)
      const parsed = JSON.parse(result)

      expect(parsed).toEqual({
        state: true,
        nested: { a: 1, b: 2 },
        array: [1, 2, 3],
        _bot: { name: 'test' },
        _tz: 123
      })
    })

    test('should handle metadata overriding payload properties', () => {
      const payload = { _bot: 'should-be-overridden' }
      const meta = { _bot: { name: 'correct' } }

      const result = contentProcessors.json.write(payload, meta)
      const parsed = JSON.parse(result)

      expect(parsed._bot).toEqual({ name: 'correct' })
    })
  })

  describe('Module structure', () => {
    test('should export both json and plain processors', () => {
      expect(contentProcessors).toHaveProperty('json')
      expect(contentProcessors).toHaveProperty('plain')
    })

    test('should have read and write methods on both processors', () => {
      expect(typeof contentProcessors.json.read).toBe('function')
      expect(typeof contentProcessors.json.write).toBe('function')
      expect(typeof contentProcessors.plain.read).toBe('function')
      expect(typeof contentProcessors.plain.write).toBe('function')
    })
  })
})
