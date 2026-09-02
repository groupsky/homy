const { buildRecord, RAW_LENGTH } = require('../record')

// buildRecord returns { record, error }; most assertions are about the payload
// inside the record it built.
const payloadOf = (...args) => buildRecord(...args).record.payload

describe('buildRecord', () => {
    const now = new Date('2026-07-14T00:00:00.000Z')

    it('adds a BSON Date _ts and a numeric epoch _tz from the same instant', () => {
        const payload = payloadOf('ioniq/parsed/bms', '{"_type":"ioniq","soc":36.5}', now)
        expect(payload._ts).toBeInstanceOf(Date)
        expect(payload._ts.getTime()).toBe(now.getTime())
        expect(typeof payload._tz).toBe('number')
        expect(payload._tz).toBe(now.getTime())
    })

    it('preserves the original topic and payload fields', () => {
        const { record } = buildRecord('ioniq/raw/igmp_bc03', '{"_type":"ioniq","raw":"62BC03"}', now)
        expect(record.topic).toBe('ioniq/raw/igmp_bc03')
        expect(record.payload._type).toBe('ioniq')
        expect(record.payload.raw).toBe('62BC03')
    })

    it('does not overwrite an existing _tz', () => {
        const payload = payloadOf('t', '{"_tz":111}', now)
        expect(payload._tz).toBe(111)
    })

    it('does not overwrite an existing _ts', () => {
        const preset = new Date('2020-01-01T00:00:00.000Z')
        const payload = payloadOf('t', JSON.stringify({ _ts: preset.toISOString() }), now)
        // an already-present _ts (whatever its form) is left untouched
        expect(payload._ts).toBe(preset.toISOString())
    })

    it('accepts a Buffer message like mqtt delivers', () => {
        const payload = payloadOf('t', Buffer.from('{"a":1}'), now)
        expect(payload.a).toBe(1)
        expect(payload._ts).toBeInstanceOf(Date)
    })
})

// An unparseable payload used to throw straight out of buildRecord. The caller
// is an `async` message listener (archive.js), so the throw became a rejected
// promise, and the Dockerfile's NODE_OPTIONS="--unhandled-rejections=strict"
// turned that into an uncaught exception — one bad publish killed the archiver.
// See issue #1526. mqtt-mongo-ioniq is the only record of `ioniq/#`, so the
// payload is wrapped and archived rather than dropped.
describe('buildRecord with a payload it cannot archive as-is', () => {
    const now = new Date('2026-07-14T00:00:00.000Z')

    it('does not throw on a payload that is not valid JSON', () => {
        expect(() => buildRecord('ioniq/raw/obc', 'not json', now)).not.toThrow()
    })

    it('keeps the raw payload instead of dropping it', () => {
        const payload = payloadOf('ioniq/raw/obc', '{"truncated', now)
        expect(payload._raw).toBe('{"truncated')
    })

    it('records why the payload could not be archived as an object', () => {
        const payload = payloadOf('ioniq/raw/obc', 'not json', now)
        expect(typeof payload._parseError).toBe('string')
        expect(payload._parseError).not.toHaveLength(0)
    })

    it('stamps the wrapper with both timestamps so the TTL index still expires it', () => {
        const payload = payloadOf('ioniq/raw/obc', 'not json', now)
        expect(payload._ts).toBeInstanceOf(Date)
        expect(payload._ts.getTime()).toBe(now.getTime())
        expect(payload._tz).toBe(now.getTime())
    })

    it('preserves the topic of an unparseable message', () => {
        const { record } = buildRecord('ioniq/raw/igmp_bc03', 'not json', now)
        expect(record.topic).toBe('ioniq/raw/igmp_bc03')
    })

    it('bounds the archived raw payload and marks the truncation', () => {
        const huge = 'x'.repeat(RAW_LENGTH + 500)
        const payload = payloadOf('t', huge, now)
        // Bounded so an oversized publish cannot push the document past
        // MongoDB's 16 MB limit and make insertOne — which is fatal — fail.
        expect(payload._raw).toBe(`${'x'.repeat(RAW_LENGTH)}... (${RAW_LENGTH + 500} chars)`)
    })

    it('wraps JSON null, which parses but cannot carry timestamps', () => {
        const payload = payloadOf('t', 'null', now)
        expect(payload._raw).toBe('null')
        expect(payload._ts).toBeInstanceOf(Date)
    })

    it('wraps a JSON scalar, whose timestamps would otherwise be silently lost', () => {
        const payload = payloadOf('t', '5', now)
        expect(payload._raw).toBe('5')
        expect(payload._ts).toBeInstanceOf(Date)
    })

    it('wraps a JSON array, which a TTL index on payload._ts cannot reach', () => {
        const payload = payloadOf('t', '[1,2]', now)
        expect(payload._raw).toBe('[1,2]')
        expect(payload._ts).toBeInstanceOf(Date)
    })

    // The caller decides whether to log a parse failure from this flag, never
    // from a field on the document: `_parseError` and `_raw` are ordinary JSON
    // keys a publisher can send in a perfectly valid payload.
    it('reports no error for a well-formed payload', () => {
        expect(buildRecord('t', '{"soc":36}', now).error).toBeNull()
    })

    it('reports no error for a valid payload that carries a _parseError of its own', () => {
        const { record, error } = buildRecord('t', '{"_parseError":"legit","soc":36}', now)
        expect(error).toBeNull()
        expect(record.payload._parseError).toBe('legit')
    })

    it('reports no error for a valid payload that carries a _raw of its own', () => {
        expect(buildRecord('t', '{"_raw":"62BC03"}', now).error).toBeNull()
    })

    it('reports the parse failure as the error', () => {
        const { error } = buildRecord('t', 'not json', now)
        expect(typeof error).toBe('string')
        expect(error).not.toHaveLength(0)
    })

    it('reports why a non-object payload was wrapped', () => {
        expect(buildRecord('t', '5', now).error).toBe('payload is not a JSON object (number)')
    })

    it('accepts a Buffer for an unparseable message too', () => {
        const payload = payloadOf('t', Buffer.from('not json'), now)
        expect(payload._raw).toBe('not json')
    })
})
