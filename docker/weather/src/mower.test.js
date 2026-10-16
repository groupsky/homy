const {buildMowerQueries, mowerPoints, createMowerEstimator, STORED, LOOKBACK_HOURS} = require('./mower')

const hour = 3600
const at = (iso) => Date.parse(iso) / 1000
const h = at('2026-10-16T02:00:00Z')
const windowStart = h - 1800

// Battery quarter means covering the 3-hour quiet span and the window of the point at h.
const quietFrom = windowStart - 3 * hour
const quarters = (temp = 15) => Array.from({length: 16}, (_, i) => [quietFrom + i * 900, temp])
// Idle and docked since long before the quiet span (state messages repeat every 3 hours).
const idleModes = () => [[h - 9 * hour, 0], [h - 6 * hour, 0], [h - 3 * hour, 0], [h, 0]]
const docked = () => [[h - 9 * hour, true], [h - 6 * hour, true], [h - 3 * hour, true], [h, true]]

function run({temperature = quarters(), modes = idleModes(), stations = docked(), stored = []} = {}) {
    return mowerPoints({temperature, modes, stations, startSec: h, endSec: h + hour, stored})[0]
}

describe('buildMowerQueries', () => {
    test('reads battery quarters for the windows, and raw mode and station events with a look-back', () => {
        const q = buildMowerQueries(h, h + 2 * hour)
        expect(q.temperature).toBe(
            `SELECT mean("temperature") FROM "sunseeker_battery_detail" WHERE time >= ${h - 1800 - 3 * hour}s AND time < ${h + 2 * hour - 1800}s GROUP BY time(15m)`)
        const from = h - 1800 - 3 * hour - LOOKBACK_HOURS * hour
        expect(q.modes).toBe(`SELECT "mode" FROM "sunseeker_mode" WHERE time >= ${from}s AND time < ${h + 2 * hour - 1800}s`)
        expect(q.stations).toBe(`SELECT "at_station" FROM "sunseeker_station" WHERE time >= ${from}s AND time < ${h + 2 * hour - 1800}s`)
    })
})

describe('mowerPoints', () => {
    test('docked and idle for more than 3 hours is valid', () => {
        expect(run()).toEqual({
            measurement: 'weather',
            tags: {source: 'mower', kind: 'estimate'},
            fields: {temperature: 15},
            integers: {},
            booleans: {valid: true},
            strings: {reason: 'ok'},
            time: h,
        })
    })

    test('the temperature is the mean of the four quarters of the window', () => {
        const temperature = [...quarters(9).slice(0, 12), [windowStart, 14], [windowStart + 900, 15], [windowStart + 1800, 15], [windowStart + 2700, 16]]
        expect(run({temperature}).fields.temperature).toBe(15)
    })

    test('a missing quarter in the window gives no_data and no temperature', () => {
        const p = run({temperature: quarters().slice(0, 15)})
        expect(p.strings.reason).toBe('no_data')
        expect(p.fields).toEqual({})
    })

    test('a stored period gives stored, also when it has no end yet', () => {
        expect(run({stored: [{from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z'}]}).strings.reason).toBe('stored')
        expect(run({stored: [{from: '2026-10-01T00:00:00Z', to: null}]}).strings.reason).toBe('stored')
        expect(run({stored: [{from: '2026-10-17T00:00:00Z', to: null}]}).strings.reason).toBe('ok')
    })

    test('no mode message in the look-back before the quiet span gives state_unknown', () => {
        const modes = [[h - 2 * hour, 0], [h, 0]]
        expect(run({modes}).strings.reason).toBe('state_unknown')
        const stations = [[h, true]]
        expect(run({stations}).strings.reason).toBe('state_unknown')
    })

    test('off the dock gives not_docked', () => {
        expect(run({stations: [...docked().slice(0, 3), [h - 10 * 60, false]]}).strings.reason).toBe('not_docked')
        expect(run({stations: [...docked(), [h + 5 * 60, false]]}).strings.reason).toBe('not_docked')
    })

    test('charging in the window gives charging', () => {
        expect(run({modes: [...idleModes(), [h + 60, 3]]}).strings.reason).toBe('charging')
        expect(run({modes: [[h - 9 * hour, 0], [h - 6 * hour, 0], [h - 3 * hour, 0], [h - hour, 3]]}).strings.reason).toBe('charging')
    })

    test('mowing in the window gives mowing', () => {
        expect(run({modes: [...idleModes(), [h + 60, 1]]}).strings.reason).toBe('mowing')
        expect(run({modes: [...idleModes(), [h + 60, 7]]}).strings.reason).toBe('mowing')
    })

    test('charging or mowing less than 3 hours before the window gives recent_activity', () => {
        const recent = [[h - 9 * hour, 0], [h - 4 * hour, 3], [h - 2 * hour, 0], [h, 0]]
        expect(run({modes: recent}).strings.reason).toBe('recent_activity')
        const before = [[h - 9 * hour, 1], [h - 4 * hour, 0], [h - hour, 0]]
        expect(run({modes: before}).strings.reason).toBe('ok')
    })

    test('off the dock in the 3 hours before the window gives recent_activity', () => {
        const stations = [[h - 9 * hour, true], [h - 3 * hour, false], [h - 2 * hour, true], [h, true]]
        expect(run({stations}).strings.reason).toBe('recent_activity')
        expect(run({stations: [[h - 2 * hour, true], [h, true]]}).strings.reason).toBe('state_unknown')
    })

    test('a battery-data gap in the 3 hours before the window gives gap_before', () => {
        const temperature = quarters().filter(([t]) => t !== quietFrom + 2 * 900)
        expect(run({temperature}).strings.reason).toBe('gap_before')
    })

    test('several dock messages in the same second keep their order', () => {
        const t = h - 1200
        expect(run({stations: [...docked().slice(0, 3), [t, true], [t, false], [t, true]]}).strings.reason).toBe('not_docked')
        const before = h - 4 * hour
        const stations = [[h - 9 * hour, true], [before, true], [before, false], [before, true], [h, true]]
        expect(run({stations}).strings.reason).toBe('ok')
    })

    test('the quiet span starts 3 hours before the window', () => {
        // Charging ended 3.5 h before the hour, which is 3 h before the window starts.
        const modes = [[h - 9 * hour, 3], [h - 3.5 * hour, 0], [h, 0]]
        expect(run({modes}).strings.reason).toBe('ok')
        const later = [[h - 9 * hour, 3], [h - 3.5 * hour + 60, 0], [h, 0]]
        expect(run({modes: later}).strings.reason).toBe('recent_activity')
    })
})

describe('STORED', () => {
    test('starts empty; a person adds a range when the mower is put away', () => {
        expect(STORED).toEqual([])
    })
})

describe('createMowerEstimator', () => {
    test('runs the three queries and builds the points', async () => {
        const asked = []
        const query = async (q) => {
            asked.push(q)
            if (q.includes('sunseeker_mode')) return [{columns: ['time', 'mode'], values: idleModes()}]
            if (q.includes('sunseeker_station')) return [{columns: ['time', 'at_station'], values: docked()}]
            return [{columns: ['time', 'mean'], values: quarters(12)}]
        }
        const {estimateHours} = createMowerEstimator({query, stored: []})
        const points = await estimateHours(h, h + hour)
        expect(asked).toHaveLength(3)
        expect(points).toEqual([expect.objectContaining({fields: {temperature: 12}, strings: {reason: 'ok'}})])
    })
})
