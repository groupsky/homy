const mqtt = require('mqtt')

function formatUnicorn (format, values) {
  let str = format.toString()

  if (typeof values === 'object') {
    for (let key in values) {
      if (!values.hasOwnProperty(key)) continue
      const value = values[key]
      const tt = typeof value
      if ('string' !== tt && 'number' !== tt) continue
      str = str.replace(new RegExp('\\{' + key + '\\}', 'gi'), value)
    }
  }

  return str
}

module.exports = ({ url, topic }) => {
  const client = mqtt.connect(url)

  const logger = (entry, device) => {
    if (!client.connected) return
    client.publish(formatUnicorn(topic, device), JSON.stringify(entry))
  }

  logger.toString = 'mqtt'

  return logger
}
