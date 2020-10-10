const mqtt = require('mqtt')
const client = mqtt.connect(process.env.BROKER || 'mqtt://localhost')
const timer = setTimeout(() => process.exit(1), 500)

client.on('connect', () => {
  client.subscribe('/homy/ard1/output', (err) => {
    if (!err) {
      client.publish('/homy/ard1/input', JSON.stringify({ t: 'ic', i: 22, p: 44, l: 0, v: 1 }))
    }
  })
})

client.on('message', (topic, message) => {
  // message is Buffer
  if (topic === '/homy/ard1/output') {
    const msg = JSON.parse(message)
    if (msg.pin === 20 && msg.value === -1) {
      clearTimeout(timer)
      client.end()
    }
  }
})
