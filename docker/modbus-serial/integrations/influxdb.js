const { InfluxDB, Point } = require('@influxdata/influxdb-client')

const mapObject = (prefix, entry, point, skip=[]) => {
  for (const key in entry) {
    if (!Object.hasOwnProperty.call(entry, key)) continue
    if (skip.includes(key)) continue
    const value = entry[key]
    switch (typeof value) {
      case 'boolean':
        point.booleanField(prefix+key, value)
        break
      case 'number':
        point.floatField(prefix+key, value)
        break
      case 'string':
        point.tag(prefix + key, value)
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

    mapObject('', entry, point, ['device', '_type', '_addr', '_ms', '_tz'])

    writeApi.writePoint(point)
  }

  logger.toString = () => 'influxdb'

  return { publish: logger }
}
