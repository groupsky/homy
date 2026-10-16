const {InfluxDB, Point} = require('@influxdata/influxdb-client')

function toInfluxPoint({measurement, tags, fields, integers, time}) {
    const p = new Point(measurement)
    for (const [key, value] of Object.entries(tags)) p.tag(key, value)
    // Every weather value is a float, also when it happens to be whole (7 °C),
    // so the field type never changes between writes.
    for (const [key, value] of Object.entries(fields)) p.floatField(key, value)
    for (const [key, value] of Object.entries(integers || {})) p.intField(key, value)
    return p.timestamp(String(time))
}

// Returns writePoints(points), which resolves when InfluxDB has the points
// and rejects when the write fails. The client's own background retries are
// off: the poller tries again on its next poll, and a backfill is run again.
function createWriter({url, token, org, bucket}) {
    const writeApi = new InfluxDB({url, token}).getWriteApi(org, bucket, 's', {
        flushInterval: 0,
        // One backfill call is at most one year of hours (8,784), so it is sent as one batch.
        batchSize: 10000,
        maxRetries: 0,
        writeFailed: (error) => Promise.reject(error),
    })
    return {
        async writePoints(points) {
            if (points.length === 0) return
            writeApi.writePoints(points.map(toInfluxPoint))
            await writeApi.flush()
        },
        close: () => writeApi.close(),
    }
}

module.exports = {toInfluxPoint, createWriter}
