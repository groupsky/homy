// Builds Open-Meteo requests and turns the answers into InfluxDB points.
//
// Points are plain objects ({measurement, tags, fields, integers, time}) so the
// conversion can be tested without the InfluxDB client. `time` is in seconds.
// All times are UTC: every request asks for timezone=GMT and unix timestamps.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

// Open-Meteo variable -> InfluxDB field. Units: °C, %, °C, %, mm, m/s, W/m².
// precipitation and shortwave_radiation cover the interval before the timestamp
// (1 hour for hourly data, 15 minutes for current values).
const VARIABLES = {
    temperature_2m: 'temperature',
    relative_humidity_2m: 'relative_humidity',
    dew_point_2m: 'dew_point',
    cloud_cover: 'cloud_cover',
    precipitation: 'precipitation',
    wind_speed_10m: 'wind_speed',
    shortwave_radiation: 'shortwave_radiation',
}
const VARIABLE_LIST = Object.keys(VARIABLES).join(',')

// The forecast API picks the best model for the place itself.
const FORECAST_MODEL = 'best_match'
const FORECAST_HOURS = 48
const MEASUREMENT = 'weather'
const SOURCE = 'open-meteo'

// Rounds the location to 2 decimals (about 1 km), which is finer than any
// model grid. The error messages never repeat the value: it is private.
function parseLocation(latitude, longitude) {
    const lat = parseCoordinate(latitude, 90, 'WEATHER_LATITUDE')
    const lon = parseCoordinate(longitude, 180, 'WEATHER_LONGITUDE')
    return {latitude: lat, longitude: lon}
}

function parseCoordinate(value, limit, name) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
    if (!Number.isFinite(number) || Math.abs(number) > limit) {
        throw new Error(`${name} must be a number between -${limit} and ${limit}`)
    }
    return number.toFixed(2)
}

function commonParams(location) {
    return {
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: 'GMT',
        timeformat: 'unixtime',
        wind_speed_unit: 'ms',
    }
}

function buildForecastUrl(location) {
    const params = new URLSearchParams({
        ...commonParams(location),
        current: VARIABLE_LIST,
        hourly: VARIABLE_LIST,
        forecast_hours: String(FORECAST_HOURS),
    })
    return `${FORECAST_URL}?${params}`
}

function buildArchiveUrl(location, model, startDate, endDate) {
    const params = new URLSearchParams({
        ...commonParams(location),
        hourly: VARIABLE_LIST,
        models: model,
        start_date: startDate,
        end_date: endDate,
    })
    return `${ARCHIVE_URL}?${params}`
}

// Picks the variables that have a number. A missing value is left out, never
// written as 0, so a gap stays a gap.
function pickFields(read) {
    const fields = {}
    for (const [variable, field] of Object.entries(VARIABLES)) {
        const value = read(variable)
        if (typeof value === 'number' && Number.isFinite(value)) {
            fields[field] = value
        }
    }
    return fields
}

function point(tags, fields, integers, time) {
    return {measurement: MEASUREMENT, tags: {source: SOURCE, ...tags}, fields, integers, time}
}

// The current block is model data in 15-minute steps, stamped with its own time.
function currentPoints(json) {
    const current = json && json.current
    if (!current || typeof current.time !== 'number') return []
    const fields = pickFields(variable => current[variable])
    if (Object.keys(fields).length === 0) return []
    return [point({kind: 'current', model: FORECAST_MODEL}, fields, {}, current.time)]
}

// The current temperature for MQTT (homy/weather/current), with the time of the
// value itself, so a reader can tell how old it is. Null without both.
function currentMessage(json) {
    const current = json && json.current
    if (!current || typeof current.time !== 'number') return null
    const temperature = current.temperature_2m
    if (typeof temperature !== 'number' || !Number.isFinite(temperature)) return null
    return {temperature, time: new Date(current.time * 1000).toISOString()}
}

function hourlyPoints(json, makePoint) {
    const hourly = json && json.hourly
    if (!hourly || !Array.isArray(hourly.time)) return []
    const points = []
    hourly.time.forEach((time, i) => {
        const fields = pickFields(variable => hourly[variable] && hourly[variable][i])
        if (Object.keys(fields).length === 0) return
        const p = makePoint(time, fields)
        if (p) points.push(p)
    })
    return points
}

// Each forecast hour is stored at its target time with the issue hour (the
// hour it was fetched in) and the lead time. A later forecast for the same
// target hour has a different lead time, so it does not overwrite the earlier one.
function forecastPoints(json, nowSec) {
    const issued = Math.floor(nowSec / 3600) * 3600
    return hourlyPoints(json, (time, fields) => {
        if (time < issued) return null
        const lead = Math.round((time - issued) / 3600)
        return point({kind: 'forecast', model: FORECAST_MODEL, lead_hours: String(lead)}, fields, {issued}, time)
    })
}

// Past hourly values of one named model. Hours after `notAfterSec` are left
// out: for models without delay they are still forecast values.
function historyPoints(json, model, notAfterSec) {
    return hourlyPoints(json, (time, fields) => {
        if (time > notAfterSec) return null
        return point({kind: 'history', model}, fields, {}, time)
    })
}

function checkResponse(status, body) {
    if (status === 200 && body && !body.error) return body
    const reason = body && body.reason ? `: ${body.reason}` : ''
    throw new Error(`Open-Meteo answered ${status}${reason}`)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(text) {
    const date = DATE.test(text) ? new Date(`${text}T00:00:00Z`) : new Date(NaN)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw new Error(`Not a date (YYYY-MM-DD): ${text}`)
    }
    return date
}

// Splits a date range into calendar years, so one archive call stays small.
function yearChunks(startDate, endDate) {
    const start = parseDate(startDate)
    const end = parseDate(endDate)
    if (start > end) throw new Error(`Start ${startDate} is after end ${endDate}`)
    const chunks = []
    for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
        const from = year === start.getUTCFullYear() ? startDate : `${year}-01-01`
        const to = year === end.getUTCFullYear() ? endDate : `${year}-12-31`
        chunks.push([from, to])
    }
    return chunks
}

module.exports = {
    parseLocation,
    buildForecastUrl,
    buildArchiveUrl,
    currentPoints,
    currentMessage,
    forecastPoints,
    historyPoints,
    checkResponse,
    parseDate,
    yearChunks,
}
