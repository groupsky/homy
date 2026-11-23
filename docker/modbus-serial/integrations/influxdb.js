const { InfluxDB, Point } = require('@influxdata/influxdb-client')

// InfluxDB 1.x reserves the name "time": it strips such a field and fails the
// write with "partial write", so a device's own clock (for example the
// OR-WE-526 "time" register) is stored as "device_time" instead.
const fieldName = (name) => name === 'time' ? 'device_time' : name

const mapObject = (prefix, entry, point, skip=[]) => {
  for (const key in entry) {
    if (!Object.hasOwnProperty.call(entry, key)) continue
    if (skip.includes(key)) continue
    const value = entry[key]
    const name = fieldName(prefix + key)
    switch (typeof value) {
      case 'boolean':
        point.booleanField(name, value)
        break
      case 'number':
        point.floatField(name, value)
        break
      case 'string':
        point.tag(name, value)
        break
      case 'object':
        if (!Array.isArray(value)) {
          mapObject(prefix+key+'.', value, point)
        }
        break
    }
  }
}

module.exports = ({
  url,
  username,
  password,
  token = `${username}:${password}`,
  org = '',
  database,
  rp = 'autogen',
  bucket = `${database}/${rp}`,
  tags,
  measurement = 'modbus'
}) => {
  // The client's close() can drop points that wait for a retry and can return
  // before an earlier HTTP write is done. So the points are counted here: close()
  // waits until every published point is written or known to be lost.
  let published = 0
  let delivered = 0
  let lost = 0
  let closing = false
  let failedWhileClosing = false
  let wake = null
  const pending = () => published - delivered - lost
  const notify = () => { if (wake) wake() }

  const writeApi = new InfluxDB({ url, token })
    .getWriteApi(org, bucket, 'ms', {
      defaultTags: tags,
      writeSuccess: (lines) => { delivered += lines.length; notify() },
      writeFailed: () => { if (closing) { failedWhileClosing = true; notify() } },
      writeRetrySkipped: ({lines}) => { lost += lines.length; notify() },
    })

  const logger = (entry) => {
    const point = new Point(measurement)
      .tag('device.name', entry.device)
      .tag('device.type', entry._type)
      .tag('device.addr', entry._addr)
      .timestamp(entry._tz)

    // index.js hands the same object to every integration, and the mongodb
    // integration's insertOne adds an ObjectId _id to it. Written as is, its
    // bytes became 12 fields _id.buffer.0 to _id.buffer.11 (#1778).
    mapObject('', entry, point, ['device', '_type', '_addr', '_ms', '_tz', '_id'])

    published++
    writeApi.writePoint(point)
  }

  logger.toString = () => 'influxdb'

  // Sends the points still in the client's memory batch, including the ones
  // waiting for a retry, and waits for the writes in flight. It rejects when a
  // point was not delivered. Called when the service stops (#1971); the caller
  // sets the deadline.
  // A failed flush rejects, but its points stay in the client's retry buffer
  // and are counted as pending, so the failure is reported below.
  const flushAll = () => writeApi.flush(true).catch(() => {})

  const close = async () => {
    closing = true
    await flushAll()
    // A write that started earlier can still be in flight: wait for its result.
    while (pending() > 0 && !failedWhileClosing) {
      await new Promise((resolve) => { wake = resolve })
      wake = null
    }
    if (pending() > 0) {
      // The write in flight failed: try its points once more.
      await flushAll()
    }
    if (pending() > 0) {
      throw new Error(`${pending()} points were not written to InfluxDB`)
    }
    await writeApi.close()
  }

  return { publish: logger, close }
}
