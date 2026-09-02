const EventEmitter = require('events')
const { startArchiving } = require('../archive')

// Minimal fakes standing in for the mqtt client and the mongo collection, so
// the wiring is exercised for real without a broker or database. createIndex
// returns a promise we control, to model a slow index build.
function fakeCollection() {
    return {
        inserted: [],
        indexCalls: [],
        insertOne(doc) {
            this.inserted.push(doc)
            return Promise.resolve()
        },
        createIndex(keys, options) {
            this.indexCalls.push([keys, options])
            // Never resolves: models an index build still in progress.
            return new Promise(() => {})
        },
    }
}

describe('startArchiving', () => {
    it('archives each MQTT message as a built record', async () => {
        const client = new EventEmitter()
        const collection = fakeCollection()
        startArchiving({ client, collection, env: {} })

        client.emit('message', 'ioniq/parsed/bms/2101', '{"_type":"ioniq","soc":36}')
        await Promise.resolve()

        expect(collection.inserted).toHaveLength(1)
        expect(collection.inserted[0].topic).toBe('ioniq/parsed/bms/2101')
        expect(collection.inserted[0].payload.soc).toBe(36)
        expect(collection.inserted[0].payload._ts).toBeInstanceOf(Date)
    })

    it('keeps archiving messages while the TTL index is still building', async () => {
        const client = new EventEmitter()
        const collection = fakeCollection() // createIndex stays pending forever
        startArchiving({ client, collection, env: { TTL_EXPIRE_SECONDS: '7776000' } })

        // The index build was kicked off...
        expect(collection.indexCalls).toHaveLength(1)
        expect(collection.indexCalls[0][0]).toEqual({ 'payload._ts': 1 })

        // ...but a message arriving before it completes is still archived,
        // because the message handler is registered without awaiting the build.
        client.emit('message', 'ioniq/raw/obc', '{"_type":"ioniq"}')
        await Promise.resolve()
        expect(collection.inserted).toHaveLength(1)
    })

    it('does not create a TTL index when TTL_EXPIRE_SECONDS is unset', () => {
        const client = new EventEmitter()
        const collection = fakeCollection()
        startArchiving({ client, collection, env: {} })
        expect(collection.indexCalls).toHaveLength(0)
    })
})

// The message listener is `async`, so anything thrown inside it became a
// rejected promise that EventEmitter.emit discards — and the Dockerfile sets
// NODE_OPTIONS="--unhandled-rejections=strict", which turns that into an
// uncaught exception and exit 1. The listener is invoked directly here (rather
// than through emit) precisely so its promise can be asserted on. Issue #1526.
describe('startArchiving with a malformed payload', () => {
    // The registered listener, so the promise emit() would have thrown away is
    // observable.
    function messageListener(client) {
        const [listener] = client.listeners('message')
        return listener
    }

    it('does not reject when the payload is not valid JSON', async () => {
        const client = new EventEmitter()
        startArchiving({ client, collection: fakeCollection(), env: {} })

        await expect(messageListener(client)('ioniq/raw/obc', 'not json')).resolves.toBeUndefined()
    })

    it('archives the raw payload rather than dropping it', async () => {
        const client = new EventEmitter()
        const collection = fakeCollection()
        startArchiving({ client, collection, env: {} })

        await messageListener(client)('ioniq/raw/obc', '{"truncated')

        expect(collection.inserted).toHaveLength(1)
        expect(collection.inserted[0].topic).toBe('ioniq/raw/obc')
        expect(collection.inserted[0].payload._raw).toBe('{"truncated')
        expect(collection.inserted[0].payload._ts).toBeInstanceOf(Date)
    })

    it('logs the topic and a bounded preview of the payload', async () => {
        const client = new EventEmitter()
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
        startArchiving({ client, collection: fakeCollection(), env: {} })

        await messageListener(client)('ioniq/raw/obc', 'z'.repeat(250))

        expect(errors).toHaveBeenCalledTimes(1)
        const line = errors.mock.calls[0].join(' ')
        expect(line).toContain('ioniq/raw/obc')
        expect(line).toContain(`${'z'.repeat(100)}... (250 chars)`)
        // Bounded: the full 250-character payload never reaches the log.
        expect(line).not.toContain('z'.repeat(101))
    })

    it('still archives a later well-formed message on the same topic', async () => {
        const client = new EventEmitter()
        const collection = fakeCollection()
        jest.spyOn(console, 'error').mockImplementation(() => {})
        startArchiving({ client, collection, env: {} })

        await messageListener(client)('ioniq/raw/obc', 'not json')
        await messageListener(client)('ioniq/raw/obc', '{"_type":"ioniq","raw":"62BC03"}')

        expect(collection.inserted).toHaveLength(2)
        expect(collection.inserted[1].payload.raw).toBe('62BC03')
        expect(collection.inserted[1].payload._parseError).toBeUndefined()
    })

    it('does not log for a well-formed payload', async () => {
        const client = new EventEmitter()
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
        startArchiving({ client, collection: fakeCollection(), env: {} })

        await messageListener(client)('ioniq/parsed/bms/2101', '{"_type":"ioniq","soc":36}')

        expect(errors).not.toHaveBeenCalled()
    })
})
