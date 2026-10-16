// Night outdoor-temperature estimate from the solar collector probe (#1735).
//
// The probe t3 of the SR-04 solar controller (device solar_heater) sits in the
// collector, outdoors. At night, with the solar pump off, it follows the air.
// By day the sun heats it, while the pump runs the tank heats it, and right
// after sunset the collector still holds heat. So each UTC hour gets one point,
// marked valid or invalid with the reason, and the mean of t3 when there are data.
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
    // The pump must be off during the hour and the whole hour before it.
    pumpOffHoursBefore: 1,
}

// Periods with bad readings, UTC dates, both days included.
const KNOWN_BAD = [
    // 22 nights read 6 to 15 °C too warm; the cause is unknown.
    {from: '2022-07-24', to: '2022-09-16', reason: 'unexplained_warm'},
    // The probe had fallen off the collector.
    {from: '2026-06-07', to: '2026-08-09', reason: 'probe_fault'},
]

const MEASUREMENT = 'xymd1'
const DEVICE = 'solar_heater'

function validTime(date) {
    return date != null && !Number.isNaN(date.getTime())
}

// Returns null when the whole hour is dark and at least `hoursAfterSunset`
// after sunset, else 'day' or 'after_sunset'.
function sunReason(hourStartSec, location) {
    const lat = Number(location.latitude)
    const lon = Number(location.longitude)
    const start = hourStartSec * 1000
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

function knownBadReason(hourStartSec, knownBad) {
    for (const {from, to, reason} of knownBad) {
        const fromSec = Date.parse(`${from}T00:00:00Z`) / 1000
        const toSec = Date.parse(`${to}T00:00:00Z`) / 1000 + 86400
        if (hourStartSec >= fromSec && hourStartSec < toSec) return reason
    }
    return null
}

// Both queries start one hour early, for the pump check of the first hour.
function buildQueries(startSec, endSec) {
    const range = `time >= ${startSec - RULES.pumpOffHoursBefore * HOUR}s AND time < ${endSec}s`
    const where = `"device.name" = '${DEVICE}'`
    return {
        temperature: `SELECT mean("t3"), count("t3") FROM "${MEASUREMENT}" WHERE ${where} AND ${range} GROUP BY time(15m)`,
        pump: `SELECT count("t3") FROM "${MEASUREMENT}" WHERE ${where} AND "outputs.p1" = true AND ${range} GROUP BY time(1h) fill(0)`,
    }
}

// temperature: [[quarterStartSec, meanT3, count], ...]; pump: [[hourStartSec, pumpOnSamples], ...]
function estimatePoints({temperature, pump, startSec, endSec, location, knownBad = KNOWN_BAD}) {
    const quarter = new Map(temperature.map(([t, mean, count]) => [t, {mean, count: count || 0}]))
    const pumpOn = new Map(pump.map(([t, count]) => [t, count || 0]))
    const hasData = (q) => q != null && q.count > 0 && typeof q.mean === 'number'

    const points = []
    for (let h = startSec; h < endSec; h += HOUR) {
        const own = QUARTERS.map(offset => quarter.get(h + offset))
        const full = own.every(hasData)
        const pumpBefore = []
        for (let i = 1; i <= RULES.pumpOffHoursBefore; i++) pumpBefore.push(h - i * HOUR)
        const before = pumpBefore.every(b => QUARTERS.some(offset => hasData(quarter.get(b + offset))))

        const reason = !full ? 'no_data'
            : knownBadReason(h, knownBad)
            || sunReason(h, location)
            || (pumpOn.get(h) > 0 ? 'pump_on' : null)
            || (!before ? 'pump_unknown' : null)
            || (pumpBefore.some(b => pumpOn.get(b) > 0) ? 'pump_recent' : null)
            || 'ok'

        const fields = {}
        if (full) {
            const mean = own.reduce((sum, q) => sum + q.mean, 0) / own.length
            fields.temperature = Math.round(mean * 1000) / 1000
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
