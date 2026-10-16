const {buildArchiveUrl, historyPoints, yearChunks, parseDate} = require('./open-meteo')

// Loads the history of one model for a date range, one calendar year per call.
// Writing the same hour again overwrites it, so a failed run can be repeated.
async function backfill({location, fetchJson, writePoints, log, model, startDate, endDate, nowSec}) {
    let total = 0
    for (const [from, to] of yearChunks(startDate, endDate)) {
        const json = await fetchJson(buildArchiveUrl(location, model, from, to))
        const points = historyPoints(json, model, nowSec)
        await writePoints(points)
        total += points.length
        log.info(`${model} ${from} to ${to}: wrote ${points.length} hours`)
    }
    return total
}

const STEP_DAYS = 30

// Builds the collector estimate for a date range (both days included), 30 days
// per step, up to the current hour. `pauseMs` between steps keeps the load on
// InfluxDB low.
async function backfillEstimate({estimateHours, writePoints, log, startDate, endDate, nowSec, pauseMs = 0}) {
    const start = parseDate(startDate).getTime() / 1000
    const end = Math.min(parseDate(endDate).getTime() / 1000 + 86400, Math.floor(nowSec / 3600) * 3600)
    let total = 0
    for (let from = start; from < end; from += STEP_DAYS * 86400) {
        if (from > start && pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs))
        const to = Math.min(from + STEP_DAYS * 86400, end)
        const points = await estimateHours(from, to)
        await writePoints(points)
        total += points.length
        const valid = points.filter(p => p.booleans && p.booleans.valid).length
        log.info(`collector ${new Date(from * 1000).toISOString().slice(0, 10)} to ${new Date(to * 1000).toISOString().slice(0, 10)}: wrote ${points.length} hours (${valid} valid)`)
    }
    return total
}

module.exports = {backfill, backfillEstimate}
