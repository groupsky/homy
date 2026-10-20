const {EventEmitter} = require('events')
const {createPublisher, CURRENT_TOPIC} = require('./mqtt')

function fakeClient({connected = true, publishError = null} = {}) {
    const client = new EventEmitter()
    client.connected = connected
    client.published = []
    client.publish = jest.fn((topic, payload, options, callback) => {
        client.published.push({topic, payload, options})
        callback(publishError)
    })
    client.endAsync = jest.fn(async () => {})
    return client
}

function setup(options) {
    const client = fakeClient(options)
    const connect = jest.fn(() => client)
    const log = {info: jest.fn(), error: jest.fn()}
    const publisher = createPublisher({url: 'mqtt://broker', connect, log})
    return {client, connect, log, publisher}
}

describe('createPublisher', () => {
    test('connects to the broker url', () => {
        const {connect} = setup()
        expect(connect).toHaveBeenCalledWith('mqtt://broker')
    })

    test('publishes the current values retained on homy/weather/current', () => {
        const {client, publisher} = setup()
        publisher.publishCurrent({temperature: 7.3, time: '2026-10-16T06:15:00.000Z'})
        expect(CURRENT_TOPIC).toBe('homy/weather/current')
        expect(client.published).toEqual([{
            topic: 'homy/weather/current',
            payload: '{"temperature":7.3,"time":"2026-10-16T06:15:00.000Z"}',
            options: expect.objectContaining({retain: true}),
        }])
    })

    // The first poll runs before the connection is up. The client keeps the
    // message and sends it once connected; it carries its own time.
    test('hands the message to the client also while not connected', () => {
        const {client, log, publisher} = setup({connected: false})
        expect(() => publisher.publishCurrent({temperature: 7, time: '2026-10-16T06:15:00.000Z'})).not.toThrow()
        expect(client.published).toEqual([expect.objectContaining({topic: 'homy/weather/current'})])
        expect(log.error).not.toHaveBeenCalled()
    })

    test('logs a failed publish and does not throw', () => {
        const {log, publisher} = setup({publishError: new Error('socket closed')})
        expect(() => publisher.publishCurrent({temperature: 7, time: '2026-10-16T06:15:00.000Z'})).not.toThrow()
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('socket closed'))
    })

    test('logs client errors instead of crashing', () => {
        const {client, log} = setup()
        expect(() => client.emit('error', new Error('connection refused'))).not.toThrow()
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
    })

    test('logs one error per outage, not one per reconnect', () => {
        const {client, log} = setup()
        client.emit('error', new Error('connect ECONNREFUSED'))
        client.emit('error', new Error('connect ECONNREFUSED'))
        expect(log.error).toHaveBeenCalledTimes(1)

        client.emit('connect')
        client.emit('error', new Error('connect ECONNREFUSED'))
        expect(log.error).toHaveBeenCalledTimes(2)
    })

    test('close ends the connection without waiting for the broker', async () => {
        const {client, publisher} = setup()
        await publisher.close()
        expect(client.endAsync).toHaveBeenCalledWith(true)
    })
})
