const EventEmitter = require('events')
const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')

jest.mock('mqtt')
const mqtt = require('mqtt')
const createMqttIntegration = require('./mqtt')

const DEVICE = {name: 'relays00-15'}
const WRITE_TOPIC = '/modbus/dry-switches/relays00-15/write'

// Stands in for a connected mqtt client: an EventEmitter, which is what the real
// client is, plus the two methods the integration calls.
function fakeClient() {
  const client = new EventEmitter()
  client.connected = true
  client.published = []
  client.publish = (topic, payload) => client.published.push([topic, payload])
  client.subscribe = (topic, cb) => cb(null)
  return client
}

// Builds the integration, completes its connect/subscribe handshake, and returns
// the client so a message can be delivered to the registered listener.
async function subscribed(callback) {
  const client = fakeClient()
  mqtt.connect.mockReturnValue(client)
  const integration = createMqttIntegration({
    url: 'mqtt://broker',
    publishTopic: '/modbus/dry-switches/{name}/reading',
    subscribeTopic: '/modbus/dry-switches/{name}/write',
  })
  client.emit('connect')
  await integration.subscribe(DEVICE, callback)
  return client
}

// Lets the microtask queue drain so a rejection handler attached to the
// subscriber's promise has run.
const flush = () => new Promise(resolve => setImmediate(resolve))

describe('mqtt subscribe', () => {
  let errors

  beforeEach(() => {
    mqtt.connect = jest.fn()
    errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errors.mockRestore()
  })

  it('delivers the parsed payload to the subscriber', async () => {
    const seen = []
    const client = await subscribed(async (message) => { seen.push(message) })

    client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":true}'))
    await flush()

    expect(seen).toEqual([{out8: true}])
  })

  it('ignores a message on another topic', async () => {
    const seen = []
    const client = await subscribed(async (message) => { seen.push(message) })

    client.emit('message', '/modbus/dry-switches/other/write', Buffer.from('{"out8":true}'))
    await flush()

    expect(seen).toHaveLength(0)
  })

  // This listener runs inside the mqtt client's stream — handlePublish emits
  // `message` from writable._write — so anything escaping it becomes an
  // unhandled `error` event on that stream and kills the process. With
  // `restart: unless-stopped` and a retained bad payload, that is a crash loop
  // that also stops the bus reader, not just the writer. Issue #1526.
  describe('with a payload that is not valid JSON', () => {
    it('does not let the failure escape the listener', async () => {
      const client = await subscribed(async () => {})

      expect(() => client.emit('message', WRITE_TOPIC, Buffer.from('not json'))).not.toThrow()
    })

    it('does not invoke the subscriber', async () => {
      const seen = []
      const client = await subscribed(async (message) => { seen.push(message) })

      client.emit('message', WRITE_TOPIC, Buffer.from('not json'))
      await flush()

      expect(seen).toHaveLength(0)
    })

    it('logs the topic and a bounded preview of the payload', async () => {
      const client = await subscribed(async () => {})

      client.emit('message', WRITE_TOPIC, Buffer.from('z'.repeat(250)))

      expect(errors).toHaveBeenCalledTimes(1)
      const line = errors.mock.calls[0].join(' ')
      expect(line).toContain(WRITE_TOPIC)
      expect(line).toContain(`${'z'.repeat(100)}... (250 chars)`)
      // Bounded, so a broken publisher cannot flood the log.
      expect(line).not.toContain('z'.repeat(101))
    })

    it('still delivers a later well-formed message on the same topic', async () => {
      const seen = []
      const client = await subscribed(async (message) => { seen.push(message) })

      client.emit('message', WRITE_TOPIC, Buffer.from('not json'))
      client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":true}'))
      await flush()

      expect(seen).toEqual([{out8: true}])
    })
  })

  // A subscriber failure is a separate fault from a parse failure and must not
  // be collapsed into the same guard: the callback is `async` and is invoked
  // without `await`, so it can fail either by throwing synchronously or by
  // rejecting. NODE_OPTIONS="--unhandled-rejections=strict" in the Dockerfile
  // makes an unhandled rejection fatal too.
  describe('with a failing subscriber', () => {
    it('does not let a synchronous throw escape the listener', async () => {
      const client = await subscribed(() => { throw new Error('write failed') })

      expect(() => client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":true}'))).not.toThrow()
    })

    it('handles a rejected promise rather than leaving it unhandled', async () => {
      const client = await subscribed(async () => { throw new Error('write failed') })

      client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":true}'))
      await flush()

      expect(errors).toHaveBeenCalledTimes(1)
      expect(errors.mock.calls[0].join(' ')).toContain('write failed')
    })

    it('reports it differently from a parse failure, so the two are distinguishable', async () => {
      const client = await subscribed(async () => { throw new Error('write failed') })

      client.emit('message', WRITE_TOPIC, Buffer.from('not json'))
      client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":true}'))
      await flush()

      expect(errors).toHaveBeenCalledTimes(2)
      const [parseLine, subscriberLine] = errors.mock.calls.map(call => call.join(' '))
      expect(parseLine).not.toBe(subscriberLine)
      expect(parseLine).toContain('parse')
      expect(subscriberLine).toContain('subscriber')
    })

    it('still delivers the next message after a subscriber failure', async () => {
      const seen = []
      const client = await subscribed(async (message) => {
        seen.push(message)
        throw new Error('write failed')
      })

      client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":true}'))
      await flush()
      client.emit('message', WRITE_TOPIC, Buffer.from('{"out8":false}'))
      await flush()

      expect(seen).toEqual([{out8: true}, {out8: false}])
    })
  })
})
