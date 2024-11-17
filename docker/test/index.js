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
        console.log(`> [${'/modbus/dry-switches/mbsl32di2/reading'}]: ${JSON.stringify({
            "inputs": 137366691,
            "_tz": Date.now(),
            "_ms": 7,
            "_addr": 32,
            "_type": "mbsl32di",
            "device": "mbsl32di2"
        })}`)
        client.publish('/modbus/dry-switches/mbsl32di2/reading', JSON.stringify({
            "inputs": 137366691,
            "_tz": Date.now(),
            "_ms": 7,
            "_addr": 32,
            "_type": "mbsl32di",
            "device": "mbsl32di2"
        }))
        console.log(`> [${'/modbus/dry-switches/mbsl32di2/reading'}]: ${JSON.stringify({
            "inputs": 3148963,
            "_tz": Date.now(),
            "_ms": 7,
            "_addr": 32,
            "_type": "mbsl32di",
            "device": "mbsl32di2"
        })}`)
        client.publish('/modbus/dry-switches/mbsl32di2/reading', JSON.stringify({
            "inputs": 3148963,
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
    if (topic === '/modbus/dry-switches/relays00-15/write') {
        const msg = JSON.parse(message)
        if (msg.out13 === true) {
            clearTimeout(timer)
            client.end()
        }
    }
})

client.on('error', (err) => {
    console.log('error', err)
})
