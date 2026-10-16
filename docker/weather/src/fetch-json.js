const {checkResponse} = require('./open-meteo')

const TIMEOUT_MS = 60 * 1000

// GETs a URL and returns the JSON body. Errors never include the URL, because
// the URL holds the house location.
async function fetchJson(url) {
    let response
    try {
        response = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)})
    } catch (error) {
        const cause = error.cause && error.cause.code ? ` (${error.cause.code})` : ''
        throw new Error(`Open-Meteo request failed: ${error.name}${cause}`)
    }
    let body = null
    try {
        body = await response.json()
    } catch {
        // checkResponse reports the status.
    }
    return checkResponse(response.status, body)
}

module.exports = {fetchJson}
