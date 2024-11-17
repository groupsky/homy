const mqtt = require('mqtt')
const brokerUrl = process.env.BROKER || 'mqtt://localhost'
console.log(`connecting ${brokerUrl}`)
const client = mqtt.connect(brokerUrl)
const timer = setTimeout(() => {
    console.error('Timeout!')
    process.exit(1)
}, 2000)
let interval = null

const publish = (topic, payload) => {
    console.log(`> [${topic}]: ${JSON.stringify(payload)}`)
    return client.publish(topic, JSON.stringify(payload))
}

client.on('connect', () => {
    console.log('connected, sending...')
    client.subscribe('#', async (err) => {
        if (err) {
            console.log('Error sending', err)
            process.exit(1)
        }
        let inputs = 0
        setInterval(() => {
            inputs = inputs === 0 ? 1 << 27 : 0
            publish('/modbus/dry-switches/mbsl32di2/reading', JSON.stringify({
                "inputs": inputs,
                "_tz": Date.now(),
                "_ms": 7,
                "_addr": 32,
                "_type": "mbsl32di",
                "device": "mbsl32di2"
            }))
        }, 100)
    })
})

client.on('message', (topic, message) => {
    console.log(`< [${topic}]: ${message}`)
    // message is Buffer
    switch (topic) {
        case '/modbus/dry-switches/relays00-15/write': {
            const msg = JSON.parse(message)
            if (msg.out8 === true) {
                clearTimeout(timer)
                clearInterval(interval)
                client.end()
            }
        }
        break
    }
})

client.on('error', (err) => {
    console.log('error', err)
})
