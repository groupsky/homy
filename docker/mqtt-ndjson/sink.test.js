const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const EventEmitter = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {createDayFileWriter} = require('./day-file-writer')
const {startWriting} = require('./sink')

// The MQTT client is a plain EventEmitter (which the real client is) and the
// writer is the real one, on a temporary directory.

const SERVICE = 'mqtt-ndjson-ioniq'
// 2026-09-28 21:30 UTC: already the 29th in local time, still the 28th in UTC.
const NOW = new Date(Date.UTC(2026, 8, 28, 21, 30))

let root
let errors

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-ndjson-'))
  errors = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

const dayFile = (day) => path.join(root, 'ioniq', `${day}.${SERVICE}.ndjson`)
const recordsIn = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))

function start({exit = jest.fn()} = {}) {
  const client = new EventEmitter()
  const writer = createDayFileWriter({root, stream: 'ioniq', service: SERVICE})
  startWriting({client, writer, now: () => NOW, exit})
  return {client, writer, exit}
}

describe('startWriting', () => {
  it('writes each message as a {topic, payload} line, stamped with _tz and _ts', () => {
    const {client} = start()

    client.emit('message', 'ioniq/parsed/bms/2101', Buffer.from('{"_type":"ioniq","soc":36}'))

    expect(recordsIn(dayFile('2026-09-28'))).toEqual([{
      topic: 'ioniq/parsed/bms/2101',
      payload: {_type: 'ioniq', soc: 36, _tz: NOW.getTime(), _ts: NOW.toISOString()},
    }])
  })

  it('files a message by the UTC day of its _tz, which a producer may have stamped already', () => {
    const {client} = start()
    const yesterday = Date.UTC(2026, 8, 27, 23, 59, 59)

    client.emit('message', 'ioniq/derived/session', Buffer.from(JSON.stringify({kind: 'end', _tz: yesterday})))

    expect(recordsIn(dayFile('2026-09-27'))).toEqual([{
      topic: 'ioniq/derived/session',
      payload: {kind: 'end', _tz: yesterday, _ts: NOW.toISOString()},
    }])
  })

  it('files a message whose own _tz is not a timestamp by the time it arrived, and keeps it as sent', () => {
    const {client} = start()

    client.emit('message', 'ioniq/raw/obc', Buffer.from('{"_tz":"soon"}'))

    expect(recordsIn(dayFile('2026-09-28'))).toEqual([{
      topic: 'ioniq/raw/obc',
      payload: {_tz: 'soon', _ts: NOW.toISOString()},
    }])
  })

  describe('with a payload that is not valid JSON', () => {
    it('keeps it raw rather than dropping it', () => {
      const {client} = start()

      client.emit('message', 'ioniq/raw/obc', Buffer.from('{"truncated'))

      const [record] = recordsIn(dayFile('2026-09-28'))
      expect(record.topic).toBe('ioniq/raw/obc')
      expect(record.payload._raw).toBe('{"truncated')
      expect(record.payload._tz).toBe(NOW.getTime())
    })

    it('logs the topic and a bounded preview of the payload', () => {
      const {client} = start()

      client.emit('message', 'ioniq/raw/obc', Buffer.from('z'.repeat(250)))

      expect(errors).toHaveBeenCalledTimes(1)
      const line = errors.mock.calls[0].join(' ')
      expect(line).toContain('ioniq/raw/obc')
      expect(line).toContain(`${'z'.repeat(100)}... (250 chars)`)
      expect(line).not.toContain('z'.repeat(101))
    })

    it('does not report a parse failure for a valid payload carrying its own _parseError', () => {
      const {client} = start()

      client.emit('message', 'ioniq/raw/obc', Buffer.from('{"_parseError":"legit"}'))

      expect(errors).not.toHaveBeenCalled()
    })
  })

  // A throw out of this listener would surface inside the mqtt client's stream
  // and kill the process without a clear reason (issue #1526). A write failure
  // is instead logged and made an explicit exit(1), as mqtt-mongo does, so the
  // container restarts and tries again.
  describe('when the file cannot be written', () => {
    it('logs it and exits with status 1, without throwing out of the listener', () => {
      fs.writeFileSync(path.join(root, 'ioniq'), '') // a file where the directory belongs
      const {client, exit} = start()

      expect(() => client.emit('message', 'ioniq/raw/obc', Buffer.from('{"a":1}'))).not.toThrow()

      expect(exit).toHaveBeenCalledWith(1)
      expect(errors.mock.calls[0].join(' ')).toContain('Failure writing')
    })
  })

  it('does not log for a well-formed payload', () => {
    const {client} = start()

    client.emit('message', 'ioniq/parsed/bms/2101', Buffer.from('{"soc":36}'))

    expect(errors).not.toHaveBeenCalled()
  })
})
