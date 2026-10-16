const {InfluxDB} = require('@influxdata/influxdb-client')

// Runs InfluxQL against the InfluxDB 1.x /query endpoint, through the same
// client library as the writer. Times come back as unix seconds (epoch=s).
// The token is "user:password" of the read user.
function createReader({url, token, database}) {
    const transport = new InfluxDB({url, token, timeout: 120 * 1000}).transport

    async function query(influxql) {
        const body = new URLSearchParams({db: database, epoch: 's', q: influxql}).toString()
        let response
        try {
            response = await transport.request('/query', body, {
                method: 'POST',
                headers: {'content-type': 'application/x-www-form-urlencoded'},
            })
        } catch (error) {
            const status = error.statusCode ? `${error.statusCode} ` : ''
            throw new Error(`InfluxDB query failed: ${status}${error.body || error.message}`)
        }
        const result = response && response.results && response.results[0]
        if (result && result.error) throw new Error(`InfluxDB query failed: ${result.error}`)
        return (result && result.series) || []
    }

    return {query}
}

module.exports = {createReader}
