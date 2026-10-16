const SunCalc = require('suncalc')
const {sunReason, buildQueries, estimatePoints, createEstimator, KNOWN_BAD} = require('./collector')

// A neutral test location; the real one comes from .env.
const location = {latitude: '45.00', longitude: '10.00'}
const hour = 3600
const at = (iso) => Date.parse(iso) / 1000

// On 2024-01-15 at 45 N 10 E the sun sets at about 16:15 UTC and rises at about 06:55 UTC.
const times = SunCalc.getTimes(new Date('2024-01-15T12:00:00Z'), 45, 10)

describe('sunReason (for the hour from the given start)', () => {
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
    test('reads t3 and pump-on samples by quarter hour, from 90 minutes before the first point to 30 minutes before the end', () => {
        const q = buildQueries(at('2024-01-15T20:00:00Z'), at('2024-01-15T22:00:00Z'))
        const range = `time >= ${at('2024-01-15T18:30:00Z')}s AND time < ${at('2024-01-15T21:30:00Z')}s`
        expect(q.temperature).toBe(
            `SELECT mean("t3") FROM "xymd1" WHERE "device.name" = 'solar_heater' AND ${range} GROUP BY time(15m)`)
        expect(q.pump).toBe(
            `SELECT count("outputs.p1") FROM "xymd1" WHERE "device.name" = 'solar_heater' AND "outputs.p1" = true AND ${range} GROUP BY time(15m)`)
    })
})

// Quarter-hour rows [time, mean] from `from`, `count` quarters long.
function quarters(from, count, temp = 1.5) {
    const rows = []
    for (let i = 0; i < count; i++) rows.push([from + i * 900, temp])
    return rows
}

describe('estimatePoints', () => {
    const start = at('2024-01-15T21:00:00Z')
    // The window of the point at `start` is 20:30 to 21:30; the pump check covers 19:30 to 20:30.
    const windowStart = start - 1800
    const checkStart = windowStart - hour
    const allData = () => quarters(checkStart, 8)

    function run({temperature, pump = [], end = start + hour, knownBad = []}) {
        return estimatePoints({temperature, pump, startSec: start, endSec: end, location, knownBad})
    }

    test('a dark hour with the pump off before and during it is valid', () => {
        expect(run({temperature: allData()})).toEqual([{
            measurement: 'weather',
            tags: {source: 'collector', kind: 'estimate'},
            fields: {temperature: 1.5},
            integers: {},
            booleans: {valid: true},
            strings: {reason: 'ok'},
            time: start,
        }])
    })

    test('the temperature is the mean of the four quarters around the hour', () => {
        const temperature = [...quarters(checkStart, 4), [windowStart, 1], [windowStart + 900, 2], [start, 3], [start + 900, 4]]
        expect(run({temperature})[0].fields.temperature).toBe(2.5)
    })

    test.each([
        ['pump_on', [[start, 13]]],
        ['pump_on', [[windowStart, 2]]],
        ['pump_recent', [[checkStart, 5]]],
        ['pump_recent', [[windowStart - 900, 1]]],
    ])('a pump run gives %s', (reason, pump) => {
        const [p] = run({temperature: allData(), pump})
        expect(p.booleans.valid).toBe(false)
        expect(p.strings.reason).toBe(reason)
        expect(p.fields.temperature).toBe(1.5)
    })

    test('a quarter without data in the window gives no_data and leaves the temperature out', () => {
        const temperature = allData().map(([t, v]) => (t === start + 900 ? [t, null] : [t, v]))
        const [p] = run({temperature})
        expect(p.strings.reason).toBe('no_data')
        expect(p.booleans.valid).toBe(false)
        expect(p.fields).toEqual({})
    })

    test('a quarter without data in the hour before means the pump state is unknown', () => {
        expect(run({temperature: quarters(windowStart, 4)})[0].strings.reason).toBe('pump_unknown')
        const gap = allData().filter(([t]) => t !== checkStart + 900)
        expect(run({temperature: gap})[0].strings.reason).toBe('pump_unknown')
    })

    test('a known bad period gives its reason', () => {
        const knownBad = [{from: '2024-01-15T12:00:00Z', to: '2024-01-16T12:00:00Z', reason: 'probe_fault'}]
        expect(run({temperature: allData(), knownBad})[0].strings.reason).toBe('probe_fault')
    })

    test('daytime hours are marked day, and every hour gets a point', () => {
        const from = at('2024-01-15T10:00:00Z')
        const points = estimatePoints({
            temperature: quarters(from - 5400, 13 * 4), pump: [], startSec: from, endSec: from + 12 * hour, location, knownBad: [],
        })
        expect(points.map(p => p.strings.reason)).toEqual([
            'day', 'day', 'day', 'day', 'day', 'day', 'day', // 10:00 to 16:00
            'after_sunset', 'after_sunset', 'after_sunset', // 17:00 to 19:00
            'ok', 'ok', // 20:00, 21:00
        ])
    })

    test('the hour before sunrise is valid when its window ends before sunrise', () => {
        const h = at('2024-01-16T06:00:00Z') // window 05:30 to 06:30, sunrise about 06:55
        const [p] = estimatePoints({temperature: quarters(h - 5400, 8), pump: [], startSec: h, endSec: h + hour, location, knownBad: []})
        expect(p.strings.reason).toBe('ok')
    })
})

describe('KNOWN_BAD', () => {
    test('marks the warm nights of 2022 and the probe fault, whole nights each', () => {
        expect(KNOWN_BAD).toEqual([
            {from: '2022-07-24T12:00:00Z', to: '2022-09-17T12:00:00Z', reason: 'unexplained_warm'},
            {from: '2026-06-07T12:00:00Z', to: '2026-08-10T12:00:00Z', reason: 'probe_fault'},
        ])
    })

    test('the morning after the last day is still inside, the next night is not', () => {
        const point = (iso) => {
            const h = at(iso)
            return estimatePoints({temperature: quarters(h - 5400, 8), pump: [], startSec: h, endSec: h + hour, location})[0]
        }
        expect(point('2026-08-10T02:00:00Z').strings.reason).toBe('probe_fault')
        expect(point('2026-08-10T23:00:00Z').strings.reason).toBe('ok')
    })
})

describe('createEstimator', () => {
    test('runs both queries and turns the series into points', async () => {
        const start = at('2024-01-15T21:00:00Z')
        const asked = []
        const query = async (q) => {
            asked.push(q)
            if (q.includes('outputs.p1')) return [{columns: ['time', 'count'], values: quarters(start - 5400, 8, 0)}]
            return [{columns: ['time', 'mean'], values: quarters(start - 5400, 8, 3.25)}]
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
