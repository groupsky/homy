// Runs InfluxQL against the InfluxDB 1.x /query endpoint with the read user.
// Times come back as unix seconds (epoch=s).
function createReader({url, database, username, password}) {
    const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

    async function query(influxql) {
        const params = new URLSearchParams({db: database, epoch: 's', q: influxql})
        const response = await fetch(`${url}/query?${params}`, {
            headers: {Authorization: auth},
            signal: AbortSignal.timeout(120 * 1000),
        })
        let body = null
        try {
            body = await response.json()
        } catch {
            // The status below says what went wrong.
        }
        if (response.status !== 200) {
            const detail = body && body.error ? ` ${body.error}` : ''
            throw new Error(`InfluxDB query failed: ${response.status}${detail}`)
        }
        const result = body && body.results && body.results[0]
        if (result && result.error) throw new Error(`InfluxDB query failed: ${result.error}`)
        return (result && result.series) || []
    }

    return {query}
}

module.exports = {createReader}
