const mqtt = require('mqtt')
const brokerUrl = process.env.BROKER || 'mqtt://localhost'
console.log(`connecting ${brokerUrl}`)
const client = mqtt.connect(brokerUrl)
const timer = setTimeout(() => {
  console.error('Timeout!')
  process.exit(1)
}, 1000)

client.on('connect', () => {
  console.log('connected, sending...')
  client.subscribe('/homy/ard1/output', (err) => {
    if (err) {
      console.log('Error sending', err)
      process.exit(1)
    }
    console.log(`> [${'/homy/ard1/input'}]: ${JSON.stringify({ t: 'ic', i: 22, p: 44, l: 0, v: 1 })}`)
    client.publish('/homy/ard1/input', JSON.stringify({ t: 'ic', i: 22, p: 44, l: 0, v: 1 }))
  })
})

client.on('message', (topic, message) => {
  console.log(`< [${topic}]: ${message}`)
  // message is Buffer
  if (topic === '/homy/ard1/output') {
    const msg = JSON.parse(message)
    if (msg.pin === 20 && msg.value === -1) {
      clearTimeout(timer)
      client.end()
    }
  }
})

client.on('error', (err) => {
  console.log('error', err)
})
