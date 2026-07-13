const ioniq = require('../ioniq')

describe('ioniq converter', () => {
    // parsed BMS frame from the spec, with a nested relays object
    const bms = {
        _type: 'ioniq', group: 'bms/2101', state: 'active', ts: 1720000000000,
        soc: 36.5, hv_v: 346.9, hv_a: -2.3, '12v': 13.6, relays: { main: true },
    }

    it('returns exactly one Point', () => {
        const points = ioniq(bms)
        expect(Array.isArray(points)).toBe(true)
        expect(points).toHaveLength(1)
    })

    it('uses measurement ioniq with group and state tags', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp).toMatch(/^ioniq,group=bms\/2101,state=active /)
    })

    it('passes the epoch-ms ts straight through as the timestamp', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp.endsWith(' 1720000000000')).toBe(true)
    })

    it('types numbers as floats (no integer i-suffix) and skips reserved keys', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp).toContain('soc=36.5')
        expect(lp).toContain('hv_v=346.9')
        expect(lp).toContain('hv_a=-2.3')
        expect(lp).toContain('12v=13.6')
        expect(lp).not.toContain('_type')
        expect(lp).not.toContain('group=bms/2101i') // never an int field
    })

    it('flattens nested objects into dotted boolean field keys', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp).toContain('relays.main=T')
    })

    it('types strings as quoted string fields (DTC "none")', () => {
        const frame = { _type: 'ioniq', group: 'obd/dtc', state: 'parked', ts: 1720000000001, dtc: 'none' }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('dtc="none"')
    })

    it('handles negative sensor values (TPMS -50) and driving speed', () => {
        const frame = { _type: 'ioniq', group: 'tpms', state: 'active', ts: 1720000000002, temp: -50, speed: 54.3 }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('temp=-50')
        expect(lp).toContain('speed=54.3')
    })

    it('JSON-stringifies arrays into a single string field', () => {
        const frame = { _type: 'ioniq', group: 'cells', state: 'charging', ts: 1720000000003, dc: 343, cells: [1, 2, 3] }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('dc=343')
        expect(lp).toContain('cells="[1,2,3]"')
    })

    it('skips null/undefined leaves', () => {
        const frame = { _type: 'ioniq', group: 'x', state: 'parked', ts: 1720000000004, a: null, b: undefined, c: 1 }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('c=1')
        expect(lp).not.toContain('a=')
        expect(lp).not.toContain('b=')
    })

    it('does not throw on a payload with no numeric/decodable fields', () => {
        const frame = { _type: 'ioniq', group: 'status', state: 'parked', ts: 1720000000005 }
        expect(() => ioniq(frame)).not.toThrow()
        expect(ioniq(frame)).toHaveLength(1)
    })
})
