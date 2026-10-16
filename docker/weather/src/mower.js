// Outdoor-temperature estimate from the mower battery while it is docked and idle (#1736).
//
// sunseeker-monitoring stores the battery temperature (whole °C, about every
// 5 minutes) in sunseeker_battery_detail, the mode in sunseeker_mode and the
// dock state in sunseeker_station. Docked, not charging and at least 3 hours
// after charging or mowing, the battery follows the air near the dock, a few
// degrees warmer and about 2 hours late. Each UTC hour gets one point, marked
// valid or invalid with the reason. Like the collector estimate, the point at
// hour h is the mean from h-30m to h+30m, and the rules use that window.
//
// The data come through the vendor cloud, so they stop when the internet is down.

const HOUR = 3600
const HALF_HOUR = HOUR / 2
const QUARTERS = [0, 900, 1800, 2700]

const RULES = {
    // Idle (mode 0, standby) for this long before the window.
    hoursAfterActivity: 3,
}

// Mode and station messages repeat about every 3 hours while idle, so the last
// one before a time is searched this far back. Older than that, the state is unknown.
const LOOKBACK_HOURS = 10

const STANDBY = 0
const CHARGING = 3

// Periods when the mower is stored indoors and reads the indoor temperature.
// A person adds {from, to} (ISO UTC times) when it is put away; `to` stays
// null until it comes back. Off the dock it is invalid anyway (`not_docked`),
// so this is for a mower that is stored while still reporting from a dock.
const STORED = []

function buildMowerQueries(startSec, endSec) {
    const end = endSec - HALF_HOUR
    const eventsFrom = startSec - HALF_HOUR - RULES.hoursAfterActivity * HOUR - LOOKBACK_HOURS * HOUR
    return {
        temperature: `SELECT mean("temperature") FROM "sunseeker_battery_detail" WHERE time >= ${startSec - HALF_HOUR}s AND time < ${end}s GROUP BY time(15m)`,
        modes: `SELECT "mode" FROM "sunseeker_mode" WHERE time >= ${eventsFrom}s AND time < ${end}s`,
        stations: `SELECT "at_station" FROM "sunseeker_station" WHERE time >= ${eventsFrom}s AND time < ${end}s`,
    }
}

// events: [[timeSec, value], ...] sorted by time.
// The values the state had in [from, to): the state at `from` and every change inside.
// Returns null when no event is found within the look-back before `from`.
function statesIn(events, from, to) {
    let atStart
    const inside = []
    for (const [t, value] of events) {
        if (t <= from) {
            if (t >= from - LOOKBACK_HOURS * HOUR) atStart = value
        } else if (t < to) {
            inside.push(value)
        }
    }
    if (atStart === undefined) return null
    return [atStart, ...inside]
}

function isStored(sec, stored) {
    return stored.some(({from, to}) => sec >= Date.parse(from) / 1000 && (to == null || sec < Date.parse(to) / 1000))
}

function mowerPoints({temperature, modes, stations, startSec, endSec, stored = STORED}) {
    const mean = new Map(temperature.map(([t, value]) => [t, value]))
    const byTime = (a, b) => a[0] - b[0]
    const modeEvents = [...modes].sort(byTime)
    const stationEvents = [...stations].sort(byTime)

    const points = []
    for (let h = startSec; h < endSec; h += HOUR) {
        const windowStart = h - HALF_HOUR
        const windowEnd = h + HALF_HOUR
        const quietFrom = windowStart - RULES.hoursAfterActivity * HOUR
        const own = QUARTERS.map(offset => mean.get(windowStart + offset))
        const full = own.every(value => typeof value === 'number')

        const quietModes = statesIn(modeEvents, quietFrom, windowStart)
        const windowModes = statesIn(modeEvents, windowStart, windowEnd)
        const windowStations = statesIn(stationEvents, windowStart, windowEnd)

        let reason
        if (!full) reason = 'no_data'
        else if (isStored(h, stored)) reason = 'stored'
        else if (quietModes == null || windowModes == null || windowStations == null) reason = 'state_unknown'
        else if (windowStations.some(atStation => atStation !== true)) reason = 'not_docked'
        else if (windowModes.includes(CHARGING)) reason = 'charging'
        else if (windowModes.some(mode => mode !== STANDBY)) reason = 'mowing'
        else if (quietModes.some(mode => mode !== STANDBY)) reason = 'recent_activity'
        else reason = 'ok'

        const fields = {}
        if (full) fields.temperature = Math.round(own.reduce((sum, value) => sum + value, 0) / own.length * 1000) / 1000
        points.push({
            measurement: 'weather',
            tags: {source: 'mower', kind: 'estimate'},
            fields,
            integers: {},
            booleans: {valid: reason === 'ok'},
            strings: {reason},
            time: h,
        })
    }
    return points
}

function seriesValues(series) {
    return (series && series[0] && series[0].values) || []
}

// query(influxql) resolves to the `series` of the first InfluxDB 1.x result.
function createMowerEstimator({query, stored = STORED}) {
    async function estimateHours(startSec, endSec) {
        const q = buildMowerQueries(startSec, endSec)
        const temperature = seriesValues(await query(q.temperature))
        const modes = seriesValues(await query(q.modes))
        const stations = seriesValues(await query(q.stations))
        return mowerPoints({temperature, modes, stations, startSec, endSec, stored})
    }
    return {estimateHours}
}

module.exports = {buildMowerQueries, mowerPoints, createMowerEstimator, STORED, RULES, LOOKBACK_HOURS}
