// Night outdoor-temperature estimate from the solar collector probe (#1735).
//
// The probe t3 of the SR-04 solar controller (device solar_heater) sits in the
// collector, outdoors. At night, with the solar pump off, it follows the air.
// By day the sun heats it, while the pump runs the tank heats it, and right
// after sunset the collector still holds heat. So each UTC hour gets one point,
// marked valid or invalid with the reason, and the mean of t3 when there are data.
// The point at hour h is the mean from h-30m to h+30m, so it lines up with the
// Open-Meteo values, which are readings at h. All rules use that same window.
//
// Under a clear, calm sky the collector reads below the air (it radiates to the
// sky). That is not corrected here; compare with the cloud cover from Open-Meteo.

const SunCalc = require('suncalc')

const HOUR = 3600
const DAY_MS = 86400 * 1000
const QUARTERS = [0, 900, 1800, 2700]

// Starting values from the analysis of 2026-10-15: 1 hour after dark the
// collector reads about 0.9 °C warm, 3 hours after about 0.5 °C, 7 hours after about 0.
const RULES = {
    hoursAfterSunset: 3,
    // The pump must be off during the window and this long before it.
    pumpOffMinutesBefore: 60,
}

// Periods with bad readings. Each runs from noon UTC of its first day to noon
// UTC after its last day, so it covers whole nights.
const KNOWN_BAD = [
    // 22 nights read 6 to 15 °C too warm; the cause is unknown.
    {from: '2022-07-24T12:00:00Z', to: '2022-09-17T12:00:00Z', reason: 'unexplained_warm'},
    // The probe had fallen off the collector.
    {from: '2026-06-07T12:00:00Z', to: '2026-08-10T12:00:00Z', reason: 'probe_fault'},
]

const MEASUREMENT = 'xymd1'
const DEVICE = 'solar_heater'

function validTime(date) {
    return date != null && !Number.isNaN(date.getTime())
}

// Returns null when the whole hour from `startSec` is dark and at least
// `hoursAfterSunset` after sunset, else 'day' or 'after_sunset'.
function sunReason(startSec, location) {
    const lat = Number(location.latitude)
    const lon = Number(location.longitude)
    const start = startSec * 1000
    const end = start + HOUR * 1000
    const sunsets = []
    const sunrises = []
    for (const offset of [-1, 0, 1]) {
        const times = SunCalc.getTimes(new Date(start + offset * DAY_MS), lat, lon)
        if (validTime(times.sunset)) sunsets.push(times.sunset.getTime())
        if (validTime(times.sunrise)) sunrises.push(times.sunrise.getTime())
    }
    const before = sunsets.filter(t => t <= start)
    if (before.length === 0) return 'day'
    const lastSunset = Math.max(...before)
    const after = sunrises.filter(t => t > lastSunset)
    if (after.length === 0 || end > Math.min(...after)) return 'day'
    if (start < lastSunset + RULES.hoursAfterSunset * HOUR * 1000) return 'after_sunset'
    return null
}

function knownBadReason(sec, knownBad) {
    for (const {from, to, reason} of knownBad) {
        if (sec >= Date.parse(from) / 1000 && sec < Date.parse(to) / 1000) return reason
    }
    return null
}

const HALF_HOUR = HOUR / 2
const QUARTERS_BEFORE = RULES.pumpOffMinutesBefore / 15

// Points from startSec to endSec need data from the start of the first
// window's pump check to the end of the last window (h + 30m).
function buildQueries(startSec, endSec) {
    const from = startSec - HALF_HOUR - RULES.pumpOffMinutesBefore * 60
    const range = `time >= ${from}s AND time < ${endSec - HALF_HOUR}s`
    const where = `"device.name" = '${DEVICE}'`
    return {
        temperature: `SELECT mean("t3") FROM "${MEASUREMENT}" WHERE ${where} AND ${range} GROUP BY time(15m)`,
        pump: `SELECT count("outputs.p1") FROM "${MEASUREMENT}" WHERE ${where} AND "outputs.p1" = true AND ${range} GROUP BY time(15m)`,
    }
}

// temperature: [[quarterStartSec, meanT3 or null], ...]
// pump: [[quarterStartSec, pumpOnSamples], ...]
function estimatePoints({temperature, pump, startSec, endSec, location, knownBad = KNOWN_BAD}) {
    const mean = new Map(temperature.map(([t, value]) => [t, value]))
    const pumpOn = new Map(pump.map(([t, count]) => [t, count || 0]))
    const hasData = (t) => typeof mean.get(t) === 'number'
    const pumpRan = (t) => pumpOn.get(t) > 0

    const points = []
    for (let h = startSec; h < endSec; h += HOUR) {
        const windowStart = h - HALF_HOUR
        const own = QUARTERS.map(offset => windowStart + offset)
        const before = []
        for (let i = QUARTERS_BEFORE; i >= 1; i--) before.push(windowStart - i * 900)
        const full = own.every(hasData)

        const reason = !full ? 'no_data'
            : knownBadReason(h, knownBad)
            || sunReason(windowStart, location)
            || (own.some(pumpRan) ? 'pump_on' : null)
            || (!before.every(hasData) ? 'pump_unknown' : null)
            || (before.some(pumpRan) ? 'pump_recent' : null)
            || 'ok'

        const fields = {}
        if (full) {
            const sum = own.reduce((total, t) => total + mean.get(t), 0)
            fields.temperature = Math.round(sum / own.length * 1000) / 1000
        }
        points.push({
            measurement: 'weather',
            tags: {source: 'collector', kind: 'estimate'},
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
function createEstimator({query, location, knownBad = KNOWN_BAD}) {
    async function estimateHours(startSec, endSec) {
        const q = buildQueries(startSec, endSec)
        const temperature = seriesValues(await query(q.temperature))
        const pump = seriesValues(await query(q.pump))
        return estimatePoints({temperature, pump, startSec, endSec, location, knownBad})
    }
    return {estimateHours}
}

module.exports = {sunReason, buildQueries, estimatePoints, createEstimator, KNOWN_BAD, RULES}
