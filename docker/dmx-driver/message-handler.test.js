const {beforeEach, describe, expect, it, jest} = require('@jest/globals')
const {createMessageHandler} = require('./message-handler')

const TOPIC = '/modbus/dry-switches/mbsl32di1/reading'

// Stands in for the DMX universe: records what was written to it, so the
// channel mapping is asserted on real output rather than on a mock's calls.
function fakeUniverse() {
  return {
    frames: [],
    set(values) { this.frames.push(values) },
  }
}

describe('createMessageHandler', () => {
  let universe
  let handle
  let errors

  beforeEach(() => {
    universe = fakeUniverse()
    handle = createMessageHandler(universe)
    errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('maps the dry-switch input bits onto the three DMX channels', () => {
    handle(TOPIC, '{"inputs":2592}')

    // 2592 = 32 | 512 | 2048: every mapped input closed.
    expect(universe.frames).toEqual([[128, 128, 128]])
  })

  it('leaves a channel dark when its input bit is clear', () => {
    handle(TOPIC, '{"inputs":512}')

    expect(universe.frames).toEqual([[0, 128, 0]])
  })

  it('accepts a Buffer like mqtt delivers', () => {
    handle(TOPIC, Buffer.from('{"inputs":32}'))

    expect(universe.frames).toEqual([[128, 0, 0]])
  })

  // The listener runs inside the mqtt client's stream - handlePublish emits
  // `message` from writable._write - so an exception escaping it becomes an
  // unhandled `error` event on that stream. This service's own `error` handler
  // then calls process.exit(1), and `restart: unless-stopped` plus a retained
  // bad payload makes that a crash loop. See issue #1526.
  describe('with a payload it cannot use', () => {
    it('does not throw on a payload that is not valid JSON', () => {
      expect(() => handle(TOPIC, 'not json')).not.toThrow()
    })

    it('does not throw on JSON null, which has no properties to destructure', () => {
      expect(() => handle(TOPIC, 'null')).not.toThrow()
    })

    it('drops a JSON scalar instead of blanking the universe', () => {
      handle(TOPIC, '5')

      expect(universe.frames).toHaveLength(0)
      expect(errors).toHaveBeenCalledTimes(1)
    })

    // Infinity is the case the `typeof === 'number'` check let through, and it
    // produces exactly the failure this guard exists to prevent: `Infinity & bit`
    // is 0 for every bit, so every channel goes dark. It is also the only
    // non-finite number JSON can carry - `NaN` is not valid JSON, so it is
    // stopped by the parse guard instead.
    it('drops an inputs field of Infinity rather than blanking every channel', () => {
      handle(TOPIC, '{"inputs":2592}')
      handle(TOPIC, '{"inputs":1e999}')

      expect(universe.frames).toEqual([[128, 128, 128]])
      expect(errors).toHaveBeenCalledTimes(1)
    })

    // `inputs` is an unsigned 32-bit flag field. A fractional value is silently
    // truncated by the bitwise operators and a negative one turns every mapped
    // channel on, so neither is a reading this driver should act on.
    it('drops a fractional inputs field', () => {
      handle(TOPIC, '{"inputs":32.7}')

      expect(universe.frames).toHaveLength(0)
    })

    it('drops a negative inputs field rather than lighting every channel', () => {
      handle(TOPIC, '{"inputs":-1}')

      expect(universe.frames).toHaveLength(0)
    })

    it('leaves the universe untouched rather than blanking it', () => {
      handle(TOPIC, 'not json')

      expect(universe.frames).toHaveLength(0)
    })

    it('ignores an object with no numeric inputs field', () => {
      handle(TOPIC, '{"other":1}')

      expect(universe.frames).toHaveLength(0)
      expect(errors).toHaveBeenCalledTimes(1)
    })

    it('logs the topic and a bounded preview of the payload', () => {
      handle(TOPIC, 'z'.repeat(250))

      expect(errors).toHaveBeenCalledTimes(1)
      const line = errors.mock.calls[0].join(' ')
      expect(line).toContain(TOPIC)
      expect(line).toContain(`${'z'.repeat(100)}... (250 chars)`)
      // Bounded, so a broken publisher cannot flood the log.
      expect(line).not.toContain('z'.repeat(101))
    })

    it('still applies a later well-formed message on the same topic', () => {
      handle(TOPIC, 'not json')
      handle(TOPIC, '{"inputs":32}')

      expect(universe.frames).toEqual([[128, 0, 0]])
    })

    it('keeps the previous frame, so one bad message does not reset the state', () => {
      handle(TOPIC, '{"inputs":2592}')
      handle(TOPIC, 'not json')
      handle(TOPIC, '{"inputs":2048}')

      expect(universe.frames).toEqual([[128, 128, 128], [0, 0, 128]])
    })
  })
})
