const { buildRecord } = require('../record')

describe('buildRecord', () => {
    const now = new Date('2026-07-14T00:00:00.000Z')

    it('adds a BSON Date _ts and a numeric epoch _tz from the same instant', () => {
        const { payload } = buildRecord('ioniq/parsed/bms', '{"_type":"ioniq","soc":36.5}', now)
        expect(payload._ts).toBeInstanceOf(Date)
        expect(payload._ts.getTime()).toBe(now.getTime())
        expect(typeof payload._tz).toBe('number')
        expect(payload._tz).toBe(now.getTime())
    })

    it('preserves the original topic and payload fields', () => {
        const record = buildRecord('ioniq/raw/igmp_bc03', '{"_type":"ioniq","raw":"62BC03"}', now)
        expect(record.topic).toBe('ioniq/raw/igmp_bc03')
        expect(record.payload._type).toBe('ioniq')
        expect(record.payload.raw).toBe('62BC03')
    })

    it('does not overwrite an existing _tz', () => {
        const { payload } = buildRecord('t', '{"_tz":111}', now)
        expect(payload._tz).toBe(111)
    })

    it('does not overwrite an existing _ts', () => {
        const preset = new Date('2020-01-01T00:00:00.000Z')
        const { payload } = buildRecord('t', JSON.stringify({ _ts: preset.toISOString() }), now)
        // an already-present _ts (whatever its form) is left untouched
        expect(payload._ts).toBe(preset.toISOString())
    })

    it('accepts a Buffer message like mqtt delivers', () => {
        const { payload } = buildRecord('t', Buffer.from('{"a":1}'), now)
        expect(payload.a).toBe(1)
        expect(payload._ts).toBeInstanceOf(Date)
    })
})
