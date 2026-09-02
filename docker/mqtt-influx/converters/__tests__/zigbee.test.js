const zigbee = require('../zigbee')

describe('zigbee converter', () => {
    const BASE = 'z2m/house1'

    // Shape taken from a live message on this mesh (2026-09-01), with the
    // nested cover_mode/update objects zigbee2mqtt actually sends.
    const cover = {
        cover_mode: {calibration: false, led: false, maintenance: false, reversed: false},
        external_trigger_mode: 'edge',
        last_seen: '2026-09-01T23:41:32.450Z',
        linkquality: 102,
        motor_run_status: 'Stop',
        position: 50,
        state: 'OPEN',
        update: {installed_version: 4101, latest_version: 4101, state: 'idle'},
    }

    describe('privacy: IEEE addresses must never reach InfluxDB', () => {
        // zigbee2mqtt defaults friendly_name to the IEEE address, so an
        // unnamed device publishes under it. An EUI-64 is a MAC address and
        // this repository is public.
        //
        // This fixture is a synthetic hex sequence, deliberately NOT a real
        // address from any mesh: a test asserting that MACs are never written
        // must not itself commit one.
        const ieee = '0x0123456789abcdef'

        it('drops a state message published under an IEEE address', () => {
            expect(zigbee(cover, `${BASE}/${ieee}`)).toEqual([])
        })

        it('drops an availability message published under an IEEE address', () => {
            expect(zigbee({state: 'online'}, `${BASE}/${ieee}/availability`)).toEqual([])
        })

        it('drops it whatever the case of the hex digits', () => {
            expect(zigbee(cover, `${BASE}/0x0123456789ABCDEF`)).toEqual([])
        })

        it('never emits a point whose line protocol contains an IEEE address', () => {
            const topics = [
                `${BASE}/${ieee}`,
                `${BASE}/${ieee}/availability`,
                `${BASE}/0X0123456789ABCDEF`,
            ]
            for (const topic of topics) {
                for (const point of zigbee(cover, topic)) {
                    expect(point.toLineProtocol()).not.toMatch(/0x[0-9a-f]{16}/i)
                }
            }
        })

        it('still records a device that has a friendly name', () => {
            expect(zigbee(cover, `${BASE}/1217-mariboli`)).toHaveLength(1)
        })
    })

    describe('topic parsing', () => {
        it('tags by the friendly name from a state topic', () => {
            const lp = zigbee(cover, `${BASE}/2024-back-window`)[0].toLineProtocol()
            expect(lp).toMatch(/^zigbee,device=2024-back-window /)
        })

        it('tags by the friendly name from an availability topic', () => {
            const lp = zigbee({state: 'online'}, `${BASE}/2024-back-window/availability`)[0].toLineProtocol()
            expect(lp).toMatch(/^zigbee,device=2024-back-window /)
        })

        it('works regardless of the base topic', () => {
            const lp = zigbee(cover, 'some/other/base/floor1-alarm')[0].toLineProtocol()
            expect(lp).toMatch(/^zigbee,device=floor1-alarm /)
        })

        it('ignores zigbee2mqtt bridge topics', () => {
            expect(zigbee({state: 'online'}, `${BASE}/bridge/state`)).toEqual([])
            expect(zigbee({}, `${BASE}/bridge/devices`)).toEqual([])
        })

        it('ignores a topic too short to name a device', () => {
            expect(zigbee(cover, 'z2m')).toEqual([])
            expect(zigbee(cover, '')).toEqual([])
        })
    })

    describe('availability', () => {
        it('records online as a boolean true', () => {
            const lp = zigbee({state: 'online'}, `${BASE}/ir-living/availability`)[0].toLineProtocol()
            expect(lp).toContain('available=T')
        })

        it('records offline as a boolean false', () => {
            const lp = zigbee({state: 'offline'}, `${BASE}/ir-living/availability`)[0].toLineProtocol()
            expect(lp).toContain('available=F')
        })

        it('writes only the availability field, not device attributes', () => {
            const lp = zigbee({state: 'online'}, `${BASE}/ir-living/availability`)[0].toLineProtocol()
            expect(lp).not.toContain('linkquality')
            expect(lp).not.toContain('state=')
        })
    })

    describe('state payloads', () => {
        it('records linkquality as a float, never an int', () => {
            const lp = zigbee(cover, `${BASE}/2024-back-window`)[0].toLineProtocol()
            expect(lp).toContain('linkquality=102')
            expect(lp).not.toContain('linkquality=102i')
        })

        it('keeps state as a string field so device classes cannot conflict', () => {
            const openLp = zigbee(cover, `${BASE}/2024-back-window`)[0].toLineProtocol()
            expect(openLp).toContain('state="OPEN"')
        })

        it('adds a boolean state_on for relays, which is what correlation needs', () => {
            const on = zigbee({state: 'ON', linkquality: 80}, `${BASE}/1217-mariboli`)[0].toLineProtocol()
            const off = zigbee({state: 'OFF', linkquality: 80}, `${BASE}/1217-mariboli`)[0].toLineProtocol()
            expect(on).toContain('state_on=T')
            expect(off).toContain('state_on=F')
        })

        it('does not add state_on for a cover, whose state is not on/off', () => {
            const lp = zigbee(cover, `${BASE}/2024-back-window`)[0].toLineProtocol()
            expect(lp).not.toContain('state_on')
        })

        it('converts last_seen to epoch ms and drops the ISO string', () => {
            const lp = zigbee(cover, `${BASE}/2024-back-window`)[0].toLineProtocol()
            expect(lp).toContain(`last_seen_ms=${Date.parse('2026-09-01T23:41:32.450Z')}`)
            expect(lp).not.toContain('last_seen="')
        })

        it('skips an unparseable last_seen rather than writing NaN', () => {
            const lp = zigbee({last_seen: 'not a date', linkquality: 5}, `${BASE}/floor1-alarm`)[0].toLineProtocol()
            expect(lp).not.toContain('last_seen')
            expect(lp).not.toContain('NaN')
        })

        it('flattens nested objects into dotted keys', () => {
            const lp = zigbee(cover, `${BASE}/2024-back-window`)[0].toLineProtocol()
            expect(lp).toContain('cover_mode.led=F')
            expect(lp).toContain('update.installed_version=4101')
            expect(lp).toContain('update.state="idle"')
        })

        it('skips null attributes, which zigbee2mqtt sends for unread ones', () => {
            const lp = zigbee(
                {battery: null, ir_code_to_send: null, linkquality: 60},
                `${BASE}/ir-living`
            )[0].toLineProtocol()
            expect(lp).not.toContain('battery')
            expect(lp).not.toContain('ir_code_to_send')
            expect(lp).toContain('linkquality=60')
        })

        it('records booleans and numbers from a sensor', () => {
            const lp = zigbee(
                {temperature: 21.5, humidity: 48, occupancy: true, linkquality: 120},
                `${BASE}/living-temp-humid`
            )[0].toLineProtocol()
            expect(lp).toContain('temperature=21.5')
            expect(lp).toContain('humidity=48')
            expect(lp).toContain('occupancy=T')
        })

        it('returns no points for a non-object payload', () => {
            expect(zigbee(null, `${BASE}/floor1-alarm`)).toEqual([])
            expect(zigbee([1, 2], `${BASE}/floor1-alarm`)).toEqual([])
        })
    })
})
