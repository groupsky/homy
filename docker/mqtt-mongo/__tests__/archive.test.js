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
