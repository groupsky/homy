const ioniqSession = require('../ioniq-session')

describe('ioniq-session converter', () => {
    // a closed trip record as published by the ioniq-sessions bot, spec §4.1/§4.4
    const trip = {
        _type: 'ioniq-session', kind: 'trip', start_ts: 1720000000000, end_ts: 1720002496000,
        duration_sec: 2496, distance_km: 40, odometer_coverage: 0.8,
        energy_out_kwh: 4.7, energy_regen_kwh: 0.5, energy_net_kwh: 4.2,
        efficiency_wh_per_km: 105, soc_start: 73, soc_end: 61, soc_delta_pct: -12,
        speed_avg_kph: 45.2, speed_max_kph: 98.1, power_max_kw: 62.3, ambient_c: 21.5,
        complete: true, sample_count: 812, max_gap_sec: 45,
        closed_by: 'gear_park', gear_at_close: 'P', seq: 17, schema_version: 1,
        start_truncated: true, contained_plugged: false,
        _bot: 'ioniq-sessions', _tz: 'Europe/Sofia',
    }

    it('returns exactly one Point', () => {
        const points = ioniqSession(trip)
        expect(Array.isArray(points)).toBe(true)
        expect(points).toHaveLength(1)
    })

    it('uses measurement ioniq_sessions with kind as the only tag', () => {
        const lp = ioniqSession(trip)[0].toLineProtocol()
        expect(lp).toMatch(/^ioniq_sessions,kind=trip /)
    })

    it('uses start_ts as the point timestamp', () => {
        const lp = ioniqSession(trip)[0].toLineProtocol()
        expect(lp.endsWith(' 1720000000000')).toBe(true)
    })

    it('carries end_ts as a field, not the timestamp', () => {
        const lp = ioniqSession(trip)[0].toLineProtocol()
        expect(lp).toContain('end_ts=1720002496000')
    })

    it('types numbers as floats (no integer i-suffix)', () => {
        const lp = ioniqSession(trip)[0].toLineProtocol()
        expect(lp).toContain('duration_sec=2496')
        expect(lp).toContain('distance_km=40')
        expect(lp).toContain('soc_delta_pct=-12')
        expect(lp).not.toContain('duration_sec=2496i')
    })

    it('types booleans as boolean fields', () => {
        const lp = ioniqSession(trip)[0].toLineProtocol()
        expect(lp).toContain('complete=T')
        expect(lp).toContain('start_truncated=T')
        expect(lp).toContain('contained_plugged=F')
    })

    it('types strings as quoted string fields', () => {
        const lp = ioniqSession(trip)[0].toLineProtocol()
        expect(lp).toContain('closed_by="gear_park"')
        expect(lp).toContain('gear_at_close="P"')
    })

    it('excludes kind, _bot, and _tz from the fields set (they are tag/envelope metadata)', () => {
        const fields = ioniqSession(trip)[0].toLineProtocol().split(' ')[1]
        expect(fields).not.toMatch(/(^|,)kind=/)
        expect(fields).not.toMatch(/(^|,)_bot=/)
        expect(fields).not.toMatch(/(^|,)_tz=/)
    })

    it('also excludes the ioniq.js RESERVED keys (_type, group, state, ts)', () => {
        const withLegacyReserved = {...trip, group: 'bms/2101', state: 'active', ts: 999}
        const fields = ioniqSession(withLegacyReserved)[0].toLineProtocol().split(' ')[1]
        expect(fields).not.toMatch(/(^|,)group=/)
        expect(fields).not.toMatch(/(^|,)state=/)
        expect(fields).not.toMatch(/(^|,)ts=/)
    })

    it('omits null/undefined metrics rather than writing a sentinel (unbounded charge shape, §3.3)', () => {
        // an unbounded sleep charge: energy valid, timing/power intentionally null (§4.2)
        const charge = {
            _type: 'ioniq-session', kind: 'charge', start_ts: 1720010000000, end_ts: 1720047080000,
            energy_in_kwh: 10.1, charge_ah: 27.5, soc_start: 52, soc_delta_pct: 32.5, soc_end: 84.5,
            bounds: 'unbounded', duration_is_charge: false, duration_sec: 37080,
            power_avg_kw: null, connector_confirmed: true, ac_energy_kwh: null, charge_efficiency: null,
            charge_type: undefined, complete: true, sample_count: 0, max_gap_sec: 37080,
            closed_by: 'silence_timeout', gear_at_close: null, seq: 18, schema_version: 1,
        }
        const lp = ioniqSession(charge)[0].toLineProtocol()
        const fields = lp.split(' ')[1]
        expect(fields).toContain('energy_in_kwh=10.1')
        expect(fields).not.toContain('power_avg_kw')
        expect(fields).not.toContain('ac_energy_kwh')
        expect(fields).not.toContain('charge_efficiency')
        expect(fields).not.toContain('charge_type')
        expect(fields).not.toContain('gear_at_close')
        expect(lp).toMatch(/^ioniq_sessions,kind=charge /)
    })

    it('types the park kind correctly (negative drain, boolean corroborator)', () => {
        const park = {
            _type: 'ioniq-session', kind: 'park', start_ts: 1720050000000, end_ts: 1720057200000,
            duration_sec: 7200, soc_start: 84, soc_end: 83, soc_delta_pct: -1,
            soc_drain_pct_per_day: -0.33, aux12v_start: 12.6, aux12v_end: 12.4,
            connector_confirmed: false, complete: true, sample_count: 3, max_gap_sec: 60,
            closed_by: 'gap_stationary', gear_at_close: 'P', seq: 19, schema_version: 1,
        }
        const lp = ioniqSession(park)[0].toLineProtocol()
        expect(lp).toMatch(/^ioniq_sessions,kind=park /)
        expect(lp).toContain('soc_drain_pct_per_day=-0.33')
        expect(lp).toContain('connector_confirmed=F')
    })

    it('does not throw on a minimal payload with only identity fields', () => {
        const frame = {_type: 'ioniq-session', kind: 'park', start_ts: 1720060000000}
        expect(() => ioniqSession(frame)).not.toThrow()
        expect(ioniqSession(frame)).toHaveLength(1)
    })
})
