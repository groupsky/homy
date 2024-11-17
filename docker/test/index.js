const mqtt = require('mqtt')
const brokerUrl = process.env.BROKER || 'mqtt://localhost'
console.log(`connecting ${brokerUrl}`)
const client = mqtt.connect(brokerUrl)
const timer = setTimeout(() => {
    console.error('Timeout!')
    process.exit(1)
}, 2000)

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
        publish('/modbus/dry-switches/mbsl32di2/reading', JSON.stringify({
            "inputs": 1 << 27,
            "_tz": Date.now(),
            "_ms": 7,
            "_addr": 32,
            "_type": "mbsl32di",
            "device": "mbsl32di2"
        }))
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
                client.end()
            }
        }
        break
        case 'homy/features/button/corridor1_kitchen_right/status': {
            const msg = JSON.parse(message)
            if (msg.state === true) {
                publish('/modbus/dry-switches/mbsl32di2/reading', JSON.stringify({
                    "inputs": 0,
                    "_tz": Date.now(),
                    "_ms": 7,
                    "_addr": 32,
                    "_type": "mbsl32di",
                    "device": "mbsl32di2"
                }))
            }
        }
        break
    }
})

client.on('error', (err) => {
    console.log('error', err)
})
