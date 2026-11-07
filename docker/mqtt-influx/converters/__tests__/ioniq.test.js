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
        // line protocol is `measurement,tags<space>fields<space>timestamp`; the
        // fields segment must contain only `c` — a and b were dropped entirely.
        const fields = lp.split(' ')[1]
        expect(fields).toBe('c=1')
    })

    it('does not throw on a payload with no numeric/decodable fields', () => {
        const frame = { _type: 'ioniq', group: 'status', state: 'parked', ts: 1720000000005 }
        expect(() => ioniq(frame)).not.toThrow()
        expect(ioniq(frame)).toHaveLength(1)
    })

    it('drops a bms/2101 frame with cell_min_v and cell_max_v both 0 (garbage no-data frame)', () => {
        const frame = {
            _type: 'ioniq', group: 'bms/2101', state: 'parked', ts: 1720000000006,
            hv_v: 0, aux_12v: 0, cell_min_v: 0, cell_max_v: 0, isolation_kohm: 1000,
        }
        expect(ioniq(frame)).toEqual([])
    })

    it('keeps a bms/2101 frame when only one of cell_min_v/cell_max_v is 0 (not the garbage signature)', () => {
        const frame = {
            _type: 'ioniq', group: 'bms/2101', state: 'parked', ts: 1720000000007,
            cell_min_v: 0, cell_max_v: 3.85,
        }
        expect(ioniq(frame)).toHaveLength(1)
    })

    it('drops a bms/2101 frame whose pack voltage is physically impossible', () => {
        // Observed in production 2026-08-27: a single frame decoded hv_v 5838 V,
        // hv_a 1280 A, hv_kw 7472 kW, temp_max 59 C while parked. The pack is 96
        // cells in series, so it cannot exceed ~403 V. That frame was the only
        // sample above 55 C in the whole history and tripped the pack-temp
        // critical rule; it also poisons any max() over hv_kw on a dashboard.
        const frame = {
            _type: 'ioniq', group: 'bms/2101', state: 'parked', ts: 1720000000008,
            hv_v: 5838, hv_a: 1280, hv_kw: 7472.64, temp_max: 59, temp_min: 0,
            cell_min_v: 3.7, cell_max_v: 3.7,
        }
        expect(ioniq(frame)).toEqual([])
    })

    it('drops a bms/2101 frame whose pack current is physically impossible', () => {
        const frame = {
            _type: 'ioniq', group: 'bms/2101', state: 'active', ts: 1720000000009,
            hv_v: 360, hv_a: 1280,
        }
        expect(ioniq(frame)).toEqual([])
    })

    it('keeps the real-world extremes of pack voltage and current', () => {
        // Widest values seen in 7.5 weeks of production data once the single
        // garbage frame is excluded: -207.9 A to 278.7 A, 0 V to 396.1 V.
        // hv_v legitimately reads 0 on some parked frames (contactors open),
        // so only the high side is bounded.
        for (const [hv_v, hv_a] of [[396.1, 278.7], [356.8, -207.9], [0, 0]]) {
            const frame = {
                _type: 'ioniq', group: 'bms/2101', state: 'active', ts: 1720000000010, hv_v, hv_a,
            }
            expect(ioniq(frame)).toHaveLength(1)
        }
    })

    it('does not apply the pack-plausibility guard to other groups', () => {
        // Only bms/2101 carries hv_v/hv_a with this meaning; a different group
        // that happens to use the same key must pass through untouched.
        const frame = { _type: 'ioniq', group: 'mcu', state: 'active', ts: 1720000000011, hv_v: 5838 }
        expect(ioniq(frame)).toHaveLength(1)
    })
})

// App alert messages (#1881): topic ioniq/parsed/alerts/<uid>, read by the thin
// Grafana rules in config/grafana/provisioning/alerting/ioniq-app-alerts.yaml.
describe('ioniq converter: app alert messages', () => {
    // The contract example from issue #1881.
    const firing = {
        _type: 'ioniq',
        group: 'alerts/ioniq-tpms-fl-temp-excess',
        ts: 1767261600000,
        uid: 'ioniq-tpms-fl-temp-excess',
        title: '🚗 Ioniq Tyre Hot — FL',
        summary: '🚗 FL (front-left) tyre running hot vs the other wheels',
        severity: 'warning',
        firing: 1,
        starts_at: 1767261000000,
        value: 9.4,
    }

    it('stores one point: tag group=alerts/<uid>, firing a float, strings kept, time = ts', () => {
        const points = ioniq(firing)
        expect(points).toHaveLength(1)
        const lp = points[0].toLineProtocol()
        expect(lp).toContain(',group=alerts/ioniq-tpms-fl-temp-excess ')
        expect(lp).toMatch(/[ ,]firing=1[ ,]/) // float: no integer i-suffix
        expect(lp).toContain('uid="ioniq-tpms-fl-temp-excess"')
        expect(lp).toContain('title="🚗 Ioniq Tyre Hot — FL"')
        expect(lp).toContain('summary="🚗 FL (front-left) tyre running hot vs the other wheels"')
        expect(lp).toContain('severity="warning"')
        expect(lp).toContain('starts_at=1767261000000')
        expect(lp).toContain('value=9.4')
        expect(lp.endsWith(' 1767261600000')).toBe(true)
    })

    it('also stores the summary as tag alert_summary, for the Telegram text (#1914)', () => {
        const lp = ioniq(firing)[0].toLineProtocol()
        expect(lp.startsWith('ioniq,alert_summary=🚗\\ FL\\ (front-left)\\ tyre\\ running\\ hot\\ vs\\ the\\ other\\ wheels,group=alerts/')).toBe(true)
    })

    it('stores firing_at = ts while firing, 0 when resolved (#1914)', () => {
        expect(ioniq(firing)[0].toLineProtocol()).toContain('firing_at=1767261600000')
        expect(ioniq({...firing, firing: 0})[0].toLineProtocol()).toMatch(/[ ,]firing_at=0[ ,]/)
    })

    it('drops backslashes from the tag, so the point stays valid', () => {
        const lp = ioniq({...firing, summary: 'o\\ dd\\'})[0].toLineProtocol()
        expect(lp.startsWith('ioniq,alert_summary=o\\ dd,group=')).toBe(true)
        expect(ioniq({...firing, summary: '\\'})[0].toLineProtocol()).not.toContain('alert_summary')
    })

    it('adds no alert_summary tag or firing_at outside alerts/ groups, or no tag without a summary', () => {
        const other = ioniq({_type: 'ioniq', group: 'bms/2101', ts: 1, summary: 'x', firing: 1, soc: 50})[0].toLineProtocol()
        expect(other).not.toContain('alert_summary')
        expect(other).not.toContain('firing_at')
        const {summary, ...noSummary} = firing
        expect(ioniq(noSummary)[0].toLineProtocol()).not.toContain('alert_summary')
    })
})
