// Publishes the current outdoor temperature to MQTT, retained, for bots that
// need it now (homy/weather/current). Best effort: a failure is logged and never
// thrown, so the poller and the InfluxDB writes do not depend on the broker.

const mqtt = require('mqtt')

const CURRENT_TOPIC = 'homy/weather/current'

function createPublisher({url, connect = mqtt.connect, log = console}) {
    const client = connect(url)
    // The client reconnects by itself, about once a second, and each failed try
    // is an error event. One line per outage is enough; an error event must not
    // end the process.
    let errorLogged = false
    client.on('connect', () => { errorLogged = false })
    client.on('error', (error) => {
        if (errorLogged) return
        errorLogged = true
        log.error(`MQTT error: ${error.message}`)
    })

    // `message` is {temperature, time}. While the broker is away (also before
    // the first connection) the client keeps the message and sends it when the
    // broker is back. Each one carries its own time, so a late one is harmless.
    function publishCurrent(message) {
        client.publish(CURRENT_TOPIC, JSON.stringify(message), {qos: 1, retain: true}, (error) => {
            if (error) log.error(`Publishing to ${CURRENT_TOPIC} failed: ${error.message}`)
        })
    }

    // Forced: with the broker gone, a normal end would wait for an answer that
    // never comes. A value lost at shutdown is sent again on the next start.
    return {publishCurrent, close: () => client.endAsync(true)}
}

module.exports = {createPublisher, CURRENT_TOPIC}
