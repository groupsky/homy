const { payloadPreview } = require('../payload-preview')
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

      // A malformed payload must not take the listener down with it. This runs
      // inside the mqtt client's stream - handlePublish emits `message` from
      // writable._write - so an exception escaping here becomes an unhandled
      // `error` event on that stream and kills the process. That stops the bus
      // reader as well as the writer, and with `restart: unless-stopped` and a
      // retained bad payload it is a crash loop. See issue #1526.
      let message
      try {
        message = JSON.parse(payload.toString())
      } catch (err) {
        console.error(`[mqtt] failed to parse payload for topic ${messageTopic}`,
          `"${payloadPreview(payload)}"`, err)
        return
      }

      // A failing subscriber is a separate fault, reported separately so the
      // two are distinguishable in the log. `callback` is async and is invoked
      // without `await`, so it can fail either by throwing synchronously or by
      // rejecting; the Dockerfile's NODE_OPTIONS="--unhandled-rejections=strict"
      // makes an unhandled rejection fatal too.
      const reportSubscriberError = (err) =>
        console.error(`[mqtt] error in subscriber for topic ${messageTopic}`, err)
      try {
        Promise.resolve(callback(message)).catch(reportSubscriberError)
      } catch (err) {
        reportSubscriberError(err)
      }
    })
  }

  subscribe.toString = () => 'mqtt'

  return {
    publish: logger,
    subscribe: subscribeTopic != null ? subscribe : null
  }
}
