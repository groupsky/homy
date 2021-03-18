const { InfluxDB, Point } = require('@influxdata/influxdb-client')

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
  const writeApi = new InfluxDB({ url, token })
    .getWriteApi(org, bucket, 'ms', {
      defaultTags: tags
    })

  const logger = (entry) => {
    const point = new Point(measurement)
      .tag('device.name', entry.device)
      .tag('device.type', entry._type)
      .tag('device.addr', entry._addr)
      .timestamp(entry._tz)

    for (const key in entry) {
      if (!Object.hasOwnProperty.call(entry, key)) continue
      if (['device', '_type', '_addr', '_ms', '_tz'].includes(key)) continue
      const value = entry[key]
      switch (typeof value) {
        case 'number':
          point.floatField(key, value)
          break
        case 'string':
          point.tag(key, value)
          break
      }
    }

    writeApi.writePoint(point)
  }

  logger.toString = () => 'influxdb'

  return logger
}
