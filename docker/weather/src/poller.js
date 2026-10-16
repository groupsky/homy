// One poll every 15 minutes:
// - current values on every poll;
// - the 48-hour forecast once per hour (the first poll that succeeds in it);
// - the last 14 days of history once per UTC day, from each history model;
// - the local estimates (collector #1735, mower #1736) once per hour. It redoes the last 3
//   hours, so readings that reached InfluxDB late are counted, and the last 48
//   hours on start. The same points are overwritten.
// A failed step is logged and tried again on the next poll. A missed poll is
// not filled in later, so a gap in the current values stays visible.

const {buildForecastUrl, buildArchiveUrl, currentPoints, forecastPoints, historyPoints} = require('./open-meteo')

// era5_seamless: ERA5-Land temperature and humidity (about 11 km) with ERA5
// cloud cover, wind and sun (about 25 km). It lags about 5 days.
// ecmwf_ifs: about 9 km and no lag. It covers the days ERA5 does not have yet.
const HISTORY_MODELS = ['era5_seamless', 'ecmwf_ifs']
const HISTORY_DAYS = 14
const PERIOD_MS = 15 * 60 * 1000
// Open-Meteo moves its current values every quarter hour; ask a little later.
const OFFSET_MS = 2 * 60 * 1000

function utcDate(sec) {
    return new Date(sec * 1000).toISOString().slice(0, 10)
}

const ESTIMATE_HOURS_ON_START = 48
const ESTIMATE_HOURS_REDONE = 3

function createPoller({location, fetchJson, writePoints, log = console, estimateHours = null}) {
    let lastForecastHour = null
    let lastHistoryDay = null
    let estimatedUntil = null

    async function pollForecast(nowSec) {
        const json = await fetchJson(buildForecastUrl(location))
        const hour = Math.floor(nowSec / 3600) * 3600
        const withForecast = lastForecastHour !== hour
        const current = currentPoints(json)
        const forecast = withForecast ? forecastPoints(json, nowSec) : []
        await writePoints([...current, ...forecast])
        if (withForecast) {
            lastForecastHour = hour
            log.info(`Wrote ${current.length} current and ${forecast.length} forecast points`)
        }
    }

    async function refreshHistory(nowSec) {
        const end = utcDate(nowSec)
        const start = utcDate(nowSec - HISTORY_DAYS * 86400)
        for (const model of HISTORY_MODELS) {
            const json = await fetchJson(buildArchiveUrl(location, model, start, end))
            const points = historyPoints(json, model, nowSec)
            await writePoints(points)
            log.info(`Wrote ${points.length} history points from ${model} for ${start} to ${end}`)
        }
        lastHistoryDay = end
    }

    async function estimate(nowSec) {
        const hour = Math.floor(nowSec / 3600) * 3600
        if (estimatedUntil === hour) return
        const from = estimatedUntil == null
            ? hour - ESTIMATE_HOURS_ON_START * 3600
            : Math.min(estimatedUntil, hour - ESTIMATE_HOURS_REDONE * 3600)
        const points = await estimateHours(from, hour)
        await writePoints(points)
        estimatedUntil = hour
        const valid = points.filter(p => p.booleans && p.booleans.valid).length
        log.info(`Wrote ${points.length} estimate points (${valid} valid)`)
    }

    async function pollOnce(nowSec) {
        try {
            await pollForecast(nowSec)
        } catch (error) {
            log.error(`Forecast poll failed: ${error.message}`)
        }
        if (lastHistoryDay !== utcDate(nowSec)) {
            try {
                await refreshHistory(nowSec)
            } catch (error) {
                log.error(`History refresh failed: ${error.message}`)
            }
        }
        if (estimateHours) {
            try {
                await estimate(nowSec)
            } catch (error) {
                log.error(`Estimate failed: ${error.message}`)
            }
        }
    }

    return {pollOnce}
}

function msUntilNextRun(nowMs) {
    const sincePeriod = ((nowMs - OFFSET_MS) % PERIOD_MS + PERIOD_MS) % PERIOD_MS
    return PERIOD_MS - sincePeriod
}

module.exports = {createPoller, msUntilNextRun, HISTORY_MODELS}
