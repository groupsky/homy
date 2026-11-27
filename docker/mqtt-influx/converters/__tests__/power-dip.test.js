const powerDip = require('../power-dip')

describe('power-dip converter', () => {
    // an end event as the dry-switches reader publishes it
    const end = {
        state: 'end', _tz: 1794852005521, durationMs: 4521, _type: 'power-dip', device: 'power-dip',
        readings: [
            {device: 'mbsl32di1', inputs: 0x20200013, _tz: 1794852001000},
            {device: 'mbsl32di1', inputs: 0, _tz: 1794852001037},
        ],
    }

    it('writes one point of measurement power_dip tagged with the state', () => {
        const points = powerDip(end)
        expect(points).toHaveLength(1)
        expect(points[0].toLineProtocol()).toMatch(/^power_dip,state=end /)
    })

    it('uses _tz as the timestamp and stores the duration and the held readings', () => {
        const lp = powerDip(end)[0].toLineProtocol()
        expect(lp.endsWith(' 1794852005521')).toBe(true)
        expect(lp).toContain('duration_ms=4521i')
        expect(lp).toContain('reading_count=2i')
        expect(lp).toContain('readings="[{\\"device\\":\\"mbsl32di1\\",\\"inputs\\":538968083')
    })

    it('writes a start event with no readings', () => {
        const lp = powerDip({state: 'start', _tz: 1794852001000, durationMs: 0, readings: []})[0].toLineProtocol()
        expect(lp).toBe('power_dip,state=start duration_ms=0i,reading_count=0i,readings="[]" 1794852001000')
    })
})
