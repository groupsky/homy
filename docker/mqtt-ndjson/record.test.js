const {describe, expect, it} = require('@jest/globals')
const {buildRecord, RAW_LENGTH} = require('./record')

// buildRecord returns { record, error }; most assertions are about the payload
// inside the record it built.
const payloadOf = (...args) => buildRecord(...args).record.payload

// Adapted from docker/mqtt-mongo/__tests__/record.test.js: the same stamping and
// wrapping, so during the overlap the two archives hold the same records.
describe('buildRecord', () => {
  const now = new Date('2026-07-14T00:00:00.000Z')

  it('adds _tz (epoch ms) and _ts (ISO 8601 UTC) from the same instant', () => {
    const payload = payloadOf('ioniq/parsed/bms', '{"_type":"ioniq","soc":36.5}', now)
    expect(payload._tz).toBe(now.getTime())
    expect(payload._ts).toBe('2026-07-14T00:00:00.000Z')
  })

  it('serializes _ts as the same string a BSON Date turns into in JSON', () => {
    const {record} = buildRecord('t', '{"a":1}', now)
    expect(JSON.parse(JSON.stringify(record)).payload._ts).toBe(JSON.parse(JSON.stringify({d: now})).d)
  })

  it('preserves the original topic and payload fields', () => {
    const {record} = buildRecord('ioniq/raw/igmp_bc03', '{"_type":"ioniq","raw":"62BC03"}', now)
    expect(record).toEqual({
      topic: 'ioniq/raw/igmp_bc03',
      payload: {_type: 'ioniq', raw: '62BC03', _tz: now.getTime(), _ts: now.toISOString()},
    })
  })

  it('does not overwrite an existing _tz', () => {
    expect(payloadOf('t', '{"_tz":111}', now)._tz).toBe(111)
  })

  it('does not overwrite an existing _ts', () => {
    expect(payloadOf('t', '{"_ts":"2020-01-01T00:00:00.000Z"}', now)._ts).toBe('2020-01-01T00:00:00.000Z')
  })

  it('accepts a Buffer message like mqtt delivers', () => {
    expect(payloadOf('t', Buffer.from('{"a":1}'), now).a).toBe(1)
  })
})

// An unparseable payload is wrapped and kept, not dropped or thrown: this file
// is the only record of the topics it covers, and a throw out of the MQTT
// message listener kills the process (issue #1526).
describe('buildRecord with a payload it cannot keep as-is', () => {
  const now = new Date('2026-07-14T00:00:00.000Z')

  it('does not throw on a payload that is not valid JSON', () => {
    expect(() => buildRecord('ioniq/raw/obc', 'not json', now)).not.toThrow()
  })

  it('keeps the raw payload and says why, stamped like any other payload', () => {
    const {record, error} = buildRecord('ioniq/raw/obc', '{"truncated', now)
    expect(record.topic).toBe('ioniq/raw/obc')
    expect(record.payload._raw).toBe('{"truncated')
    expect(typeof record.payload._parseError).toBe('string')
    expect(record.payload._parseError).toBe(error)
    expect(record.payload._tz).toBe(now.getTime())
    expect(record.payload._ts).toBe(now.toISOString())
  })

  it('bounds the kept raw payload and marks the truncation', () => {
    const huge = 'x'.repeat(RAW_LENGTH + 500)
    expect(payloadOf('t', huge, now)._raw).toBe(`${'x'.repeat(RAW_LENGTH)}... (${RAW_LENGTH + 500} chars)`)
  })

  it.each([
    ['null', 'null', 'object'],
    ['a scalar', '5', 'number'],
    ['an array', '[1,2]', 'object'],
  ])('wraps JSON %s, which cannot carry the timestamps', (_, message, type) => {
    const {record, error} = buildRecord('t', message, now)
    expect(record.payload._raw).toBe(message)
    expect(record.payload._tz).toBe(now.getTime())
    expect(error).toBe(`payload is not a JSON object (${type})`)
  })

  // The caller decides whether to log a parse failure from this flag, never
  // from a field on the record: `_parseError` and `_raw` are ordinary JSON keys
  // a publisher can send in a perfectly valid payload.
  it('reports no error for a well-formed payload', () => {
    expect(buildRecord('t', '{"soc":36}', now).error).toBeNull()
  })

  it('reports no error for a valid payload that carries a _parseError of its own', () => {
    const {record, error} = buildRecord('t', '{"_parseError":"legit","soc":36}', now)
    expect(error).toBeNull()
    expect(record.payload._parseError).toBe('legit')
  })
})
