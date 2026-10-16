const {buildArchiveUrl, historyPoints, yearChunks} = require('./open-meteo')

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

module.exports = {backfill}
