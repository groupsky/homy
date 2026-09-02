const { payloadPreview, PREVIEW_LENGTH } = require('../payload-preview')

describe('payloadPreview', () => {
    it('returns short payloads unchanged', () => {
        expect(payloadPreview('{"a":1}')).toBe('{"a":1}')
    })

    it('stringifies buffers', () => {
        expect(payloadPreview(Buffer.from('{"a":1}'))).toBe('{"a":1}')
    })

    it('keeps the first 100 characters by default', () => {
        const long = 'x'.repeat(250)

        expect(payloadPreview(long)).toBe(`${'x'.repeat(PREVIEW_LENGTH)}... (250 chars)`)
        expect(PREVIEW_LENGTH).toBe(100)
    })

    it('reports the full length of a truncated payload', () => {
        expect(payloadPreview('y'.repeat(101))).toContain('(101 chars)')
    })

    it('does not truncate at exactly the limit', () => {
        const exact = 'z'.repeat(PREVIEW_LENGTH)

        expect(payloadPreview(exact)).toBe(exact)
    })

    it('honours an explicit limit', () => {
        expect(payloadPreview('abcdef', 3)).toBe('abc... (6 chars)')
    })

    it('never throws on a value that cannot be stringified', () => {
        const hostile = { toString() { throw new Error('nope') } }

        expect(payloadPreview(hostile)).toBe('<unprintable payload>')
    })
})
