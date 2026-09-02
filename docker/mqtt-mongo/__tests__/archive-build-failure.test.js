const EventEmitter = require('events')

// `buildRecord` is written not to throw — fuzzing it does not produce one — but
// nothing enforces that. This file mocks it into throwing to prove the archiver
// survives regardless: the listener is `async`, so an escaping exception is a
// rejected promise, and the Dockerfile's
// NODE_OPTIONS="--unhandled-rejections=strict" turns that into exit 1. Module
// mocking is file-scoped, which is why this lives apart from archive.test.js.
jest.mock('../record', () => ({
    ...jest.requireActual('../record'),
    buildRecord: () => { throw new Error('boom from buildRecord') },
}))

const { startArchiving } = require('../archive')

function fakeCollection() {
    return {
        inserted: [],
        insertOne(doc) { this.inserted.push(doc); return Promise.resolve() },
        createIndex() { return new Promise(() => {}) },
    }
}

function messageListener(client) {
    const [listener] = client.listeners('message')
    return listener
}

describe('startArchiving when buildRecord throws', () => {
    it('does not reject, so the strict unhandled-rejections flag cannot kill the archiver', async () => {
        const client = new EventEmitter()
        jest.spyOn(console, 'error').mockImplementation(() => {})
        startArchiving({ client, collection: fakeCollection(), env: {} })

        await expect(messageListener(client)('ioniq/raw/obc', '{"soc":36}')).resolves.toBeUndefined()
    })

    it('logs the topic and a bounded preview, and drops the message', async () => {
        const client = new EventEmitter()
        const collection = fakeCollection()
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
        startArchiving({ client, collection, env: {} })

        await messageListener(client)('ioniq/raw/obc', 'z'.repeat(250))

        expect(collection.inserted).toHaveLength(0)
        expect(errors).toHaveBeenCalledTimes(1)
        const line = errors.mock.calls[0].join(' ')
        expect(line).toContain('ioniq/raw/obc')
        expect(line).toContain(`${'z'.repeat(100)}... (250 chars)`)
        expect(line).not.toContain('z'.repeat(101))
    })

    it('keeps handling later messages rather than stopping at the first failure', async () => {
        const client = new EventEmitter()
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
        startArchiving({ client, collection: fakeCollection(), env: {} })

        await messageListener(client)('ioniq/raw/obc', '{"a":1}')
        await messageListener(client)('ioniq/raw/obc', '{"b":2}')

        expect(errors).toHaveBeenCalledTimes(2)
    })
})
