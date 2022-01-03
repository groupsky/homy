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

module.exports = ({ url, publishTopic, subscribeTopic }) => {
  if (!publishTopic) throw new Error('Missing publish topic')

  const client = mqtt.connect(url)

  const connectPromise = new Promise((resolve, reject) => {
    client.once('connect', resolve)
    client.once('error', reject)
  })

  const logger = (entry, device) => {
    if (!client.connected) return
    client.publish(formatUnicorn(publishTopic, device), JSON.stringify(entry))
  }

  logger.toString = () => 'mqtt'

  const subscribe = async (device, callback) => {
    await connectPromise
    const deviceTopic = formatUnicorn(subscribeTopic, device)
    await new Promise((resolve, reject) =>
      client.subscribe(deviceTopic, (err) => {
        if (err) {
          console.error(`[mqtt] error subscribing to ${deviceTopic}`, err)
          reject(err)
          return
        }
        console.log(`[mqtt] subscribed to ${deviceTopic}`)
        resolve()
      })
    )
    client.on('message', (messageTopic, payload) => {
      if (deviceTopic !== messageTopic) {
        return
      }
      callback(JSON.parse(payload.toString()))
    })
  }

  subscribe.toString = () => 'mqtt'

  return {
    publish: logger,
    subscribe: subscribeTopic != null ? subscribe : null
  }
}
