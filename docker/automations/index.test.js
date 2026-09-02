const { afterEach, beforeEach, describe, expect, jest, test } = require('@jest/globals')
const EventEmitter = require('events')
const path = require('path')

/**
 * Regression tests for the MQTT message handler in `index.js`.
 *
 * The handler is the single dispatch point for every subscribed topic. Before
 * issue #1224 it parsed the payload with a bare `JSON.parse`, so one malformed
 * publish threw straight out of the MQTT client's `emit('message', ...)` -
 * an uncaught exception that took the whole service's message processing with
 * it, with no recovery short of a restart.
 *
 * These tests drive the real `index.js` with a fake MQTT client rather than a
 * re-implementation of the handler, because the bug lives in the wiring.
 */

const INPUT_TOPIC = 'test/malformed/in'
const OUTPUT_TOPIC = 'test/malformed/out'
const CONFIG_PATH = path.join(__dirname, '__fixtures__', 'malformed-payload-config.js')

describe('index.js MQTT message handler', () => {
  let client
  let errorSpy
  let originalConfig

  /** Minimal stand-in for the `mqtt` client surface `index.js` uses. */
  const createClient = () => {
    const emitter = new EventEmitter()
    emitter.setMaxListeners(1000)
    emitter.subscribe = jest.fn((topic, cb) => cb && cb(null))
    emitter.publish = jest.fn((topic, message, options, cb) => cb && cb(null))
    emitter.endAsync = jest.fn(async () => {})
    return emitter
  }

  beforeEach(async () => {
    jest.resetModules()

    client = createClient()
    jest.doMock('mqtt', () => ({ connect: jest.fn(() => client) }))

    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    originalConfig = process.env.CONFIG
    process.env.CONFIG = CONFIG_PATH

    require('./index')
    // Bot startup is async; the subscription only exists once it has settled.
    await new Promise((resolve) => setImmediate(resolve))
  })

  afterEach(() => {
    if (originalConfig === undefined) {
      delete process.env.CONFIG
    } else {
      process.env.CONFIG = originalConfig
    }
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  const publishedTo = (topic) => client.publish.mock.calls.filter(([t]) => t === topic)

  test('dispatches a well-formed payload to the subscriber', () => {
    client.emit('message', INPUT_TOPIC, Buffer.from(JSON.stringify({ value: 1 })))

    expect(publishedTo(OUTPUT_TOPIC)).toHaveLength(1)
    expect(JSON.parse(publishedTo(OUTPUT_TOPIC)[0][1])).toMatchObject({ value: 1 })
  })

  test('does not throw out of the handler on a malformed payload', () => {
    expect(() => client.emit('message', INPUT_TOPIC, Buffer.from('{"value": '))).not.toThrow()
  })

  test('logs the topic and a payload preview for a malformed payload', () => {
    client.emit('message', INPUT_TOPIC, Buffer.from('{"value": '))

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to parse payload for topic',
      INPUT_TOPIC,
      '"{"value": "',
      expect.any(SyntaxError)
    )
  })

  test('logs the payload preview exactly once', () => {
    client.emit('message', INPUT_TOPIC, Buffer.from('{"value": '))

    // The wrapper from contentProcessors.json.read carries the preview in its
    // own message too; logging it as well as the explicit argument repeated the
    // payload in every line. The underlying SyntaxError is logged instead.
    const rendered = errorSpy.mock.calls.at(-1).map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ')
    expect(rendered.split('{"value": ').length - 1).toBe(1)
    expect(rendered).not.toContain('Invalid JSON payload')
  })

  test('truncates the logged preview to the first 100 characters', () => {
    const longPayload = `{"value": "${'x'.repeat(500)}`
    client.emit('message', INPUT_TOPIC, Buffer.from(longPayload))

    const preview = errorSpy.mock.calls.at(-1)[2]
    expect(preview).toBe(`"${longPayload.slice(0, 100)}... (${longPayload.length} chars)"`)
  })

  test('drops only the malformed message and keeps processing the topic', () => {
    client.emit('message', INPUT_TOPIC, Buffer.from('not json at all'))
    client.emit('message', INPUT_TOPIC, Buffer.from(JSON.stringify({ value: 2 })))

    expect(publishedTo(OUTPUT_TOPIC)).toHaveLength(1)
    expect(JSON.parse(publishedTo(OUTPUT_TOPIC)[0][1])).toMatchObject({ value: 2 })
  })

  test('keeps processing other topics after a malformed payload', () => {
    const controlTopic = 'homy/automation/malformedProbe/control'
    const statusTopic = 'homy/automation/malformedProbe/status'
    const statusesBefore = publishedTo(statusTopic).length

    client.emit('message', INPUT_TOPIC, Buffer.from('{'))
    client.emit('message', controlTopic, Buffer.from(JSON.stringify({ enabled: false })))

    expect(publishedTo(statusTopic).length).toBe(statusesBefore + 1)
    expect(JSON.parse(publishedTo(statusTopic).at(-1)[1])).toMatchObject({ enabled: false })
  })
})
