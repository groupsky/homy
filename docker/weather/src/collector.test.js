const SunCalc = require('suncalc')
const {sunReason, buildQueries, estimatePoints, createEstimator, KNOWN_BAD} = require('./collector')

// A neutral test location; the real one comes from .env.
const location = {latitude: '45.00', longitude: '10.00'}
const hour = 3600
const at = (iso) => Date.parse(iso) / 1000

// On 2024-01-15 at 45 N 10 E the sun sets at about 16:15 UTC and rises at about 06:55 UTC.
const times = SunCalc.getTimes(new Date('2024-01-15T12:00:00Z'), 45, 10)

describe('sunReason', () => {
    test('the test day has the expected sunset and sunrise', () => {
        expect(times.sunset.toISOString()).toMatch(/^2024-01-15T16:/)
        expect(times.sunrise.toISOString()).toMatch(/^2024-01-15T06:5/)
    })

    test.each([
        ['2024-01-15T12:00:00Z', 'day'],
        ['2024-01-15T16:00:00Z', 'day'], // the sun sets inside this hour
        ['2024-01-15T17:00:00Z', 'after_sunset'],
        ['2024-01-15T18:00:00Z', 'after_sunset'],
        ['2024-01-15T20:00:00Z', null], // more than 3 hours after sunset
        ['2024-01-16T02:00:00Z', null],
        ['2024-01-16T05:00:00Z', null], // ends before sunrise
        ['2024-01-16T06:00:00Z', 'day'], // the sun rises inside this hour
    ])('hour starting %s gives %p', (iso, reason) => {
        expect(sunReason(at(iso), location)).toBe(reason)
    })
})

describe('buildQueries', () => {
    test('reads t3 by quarter hour and pump-on samples by hour, from one hour before the start', () => {
        const q = buildQueries(at('2024-01-15T20:00:00Z'), at('2024-01-15T22:00:00Z'))
        expect(q.temperature).toBe(
            'SELECT mean("t3"), count("t3") FROM "xymd1" WHERE "device.name" = \'solar_heater\' ' +
            'AND time >= 1705345200s AND time < 1705356000s GROUP BY time(15m)')
        expect(q.pump).toBe(
            'SELECT count("t3") FROM "xymd1" WHERE "device.name" = \'solar_heater\' AND "outputs.p1" = true ' +
            'AND time >= 1705345200s AND time < 1705356000s GROUP BY time(1h) fill(0)')
    })
})

// Builds the quarter-hour rows for hours starting at `from`, all with data.
function quarters(fromSec, hours, temp = 1.5, count = 700) {
    const rows = []
    for (let t = fromSec; t < fromSec + hours * hour; t += 900) rows.push([t, temp, count])
    return rows
}

describe('estimatePoints', () => {
    const start = at('2024-01-15T21:00:00Z')

    function run({temperature, pump = [], end = start + hour, knownBad = []}) {
        return estimatePoints({temperature, pump, startSec: start, endSec: end, location, knownBad})
    }

    test('a dark hour with the pump off before and during it is valid', () => {
        expect(run({temperature: quarters(start - hour, 2)})).toEqual([{
            measurement: 'weather',
            tags: {source: 'collector', kind: 'estimate'},
            fields: {temperature: 1.5},
            integers: {},
            booleans: {valid: true},
            strings: {reason: 'ok'},
            time: start,
        }])
    })

    test('the temperature is the mean of the quarter means', () => {
        const temperature = [...quarters(start - hour, 1), [start, 1, 700], [start + 900, 2, 700], [start + 1800, 3, 700], [start + 2700, 4, 700]]
        expect(run({temperature})[0].fields.temperature).toBe(2.5)
    })

    test.each([
        ['pump_on', {pump: [[start - hour, 0], [start, 13]]}],
        ['pump_recent', {pump: [[start - hour, 5], [start, 0]]}],
    ])('a pump run gives %s', (reason, extra) => {
        const [p] = run({temperature: quarters(start - hour, 2), ...extra})
        expect(p.booleans.valid).toBe(false)
        expect(p.strings.reason).toBe(reason)
        expect(p.fields.temperature).toBe(1.5)
    })

    test('a quarter without samples gives no_data and the temperature is left out', () => {
        const temperature = quarters(start - hour, 2).map(([t, v, c]) => t === start + 1800 ? [t, null, null] : [t, v, c])
        const [p] = run({temperature})
        expect(p.strings.reason).toBe('no_data')
        expect(p.booleans.valid).toBe(false)
        expect(p.fields).toEqual({})
    })

    test('no samples in the hour before means the pump state is unknown', () => {
        expect(run({temperature: quarters(start, 1)})[0].strings.reason).toBe('pump_unknown')
    })

    test('a known bad period gives its reason', () => {
        const knownBad = [{from: '2024-01-15', to: '2024-01-15', reason: 'probe_fault'}]
        expect(run({temperature: quarters(start - hour, 2), knownBad})[0].strings.reason).toBe('probe_fault')
    })

    test('daytime hours are marked day, and every hour gets a point', () => {
        const from = at('2024-01-15T10:00:00Z')
        const points = estimatePoints({
            temperature: quarters(from - hour, 13), pump: [], startSec: from, endSec: from + 12 * hour, location, knownBad: [],
        })
        expect(points.map(p => p.strings.reason)).toEqual([
            'day', 'day', 'day', 'day', 'day', 'day', 'day', // 10:00 to 16:00
            'after_sunset', 'after_sunset', 'after_sunset', // 17:00 to 19:00
            'ok', 'ok', // 20:00, 21:00
        ])
    })
})

describe('KNOWN_BAD', () => {
    test('marks the probe fault and the warm summer of 2022', () => {
        expect(KNOWN_BAD).toEqual([
            {from: '2022-07-24', to: '2022-09-16', reason: 'unexplained_warm'},
            {from: '2026-06-07', to: '2026-08-09', reason: 'probe_fault'},
        ])
    })

    test('the last day of a period is still inside it', () => {
        const t = at('2026-08-09T23:00:00Z')
        const [p] = estimatePoints({
            temperature: quarters(t - hour, 2), pump: [], startSec: t, endSec: t + hour, location,
        })
        expect(p.strings.reason).toBe('probe_fault')
        const next = at('2026-08-10T23:00:00Z')
        const [q] = estimatePoints({
            temperature: quarters(next - hour, 2), pump: [], startSec: next, endSec: next + hour, location,
        })
        expect(q.strings.reason).toBe('ok')
    })
})

describe('createEstimator', () => {
    test('runs both queries and turns the series into points', async () => {
        const start = at('2024-01-15T21:00:00Z')
        const asked = []
        const query = async (q) => {
            asked.push(q)
            if (q.includes('outputs.p1')) return [{columns: ['time', 'count'], values: [[start - hour, 0], [start, 0]]}]
            return [{columns: ['time', 'mean', 'count'], values: quarters(start - hour, 2, 3.25)}]
        }
        const {estimateHours} = createEstimator({query, location, knownBad: []})
        const points = await estimateHours(start, start + hour)
        expect(asked).toHaveLength(2)
        expect(points).toHaveLength(1)
        expect(points[0]).toMatchObject({fields: {temperature: 3.25}, strings: {reason: 'ok'}})
    })

    test('an empty answer gives no_data points', async () => {
        const start = at('2024-01-15T21:00:00Z')
        const {estimateHours} = createEstimator({query: async () => [], location, knownBad: []})
        const points = await estimateHours(start, start + 2 * hour)
        expect(points.map(p => p.strings.reason)).toEqual(['no_data', 'no_data'])
    })
})
