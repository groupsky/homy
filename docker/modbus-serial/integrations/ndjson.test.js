const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {ObjectId} = require('mongodb')
const createNdjsonIntegration = require('./ndjson')

const DEVICE = {name: 'boiler'}
// 2026-09-28 21:30 UTC — already 2026-09-29 in local time, still the 28th in UTC.
const TZ = Date.UTC(2026, 8, 28, 21, 30)

// What index.js builds and hands to every integration: the driver's fields plus
// the metadata pollDevice stamps on it.
const reading = () => ({
  tot: 1234.5,
  p: 2100,
  _tz: TZ,
  _ms: 42,
  _addr: 3,
  _type: 'dds519mr',
  device: 'boiler',
})

let root
let errors
let logs

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ndjson-integration-'))
  errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  logs = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

const dayFile = (day, stream = 'secondary', service = 'secondary-power') =>
  path.join(root, stream, `${day}.${service}.ndjson`)

const linesOf = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((line) => line !== '')

describe('ndjson integration', () => {
  it('writes each reading as one line to <root>/<stream>/<UTC day of _tz>.<service>.ndjson', () => {
    const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})

    publish(reading(), DEVICE)
    publish({...reading(), p: 2200, _tz: TZ + 1000}, DEVICE)

    expect(linesOf(dayFile('2026-09-28')).map((line) => JSON.parse(line))).toEqual([
      reading(),
      {...reading(), p: 2200, _tz: TZ + 1000},
    ])
  })

  it('writes the same fields as the Mongo document, in the same order', () => {
    const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})

    publish(reading(), DEVICE)

    expect(linesOf(dayFile('2026-09-28'))).toEqual([JSON.stringify(reading())])
  })

  // index.js passes the same object to every integration, and the mongodb
  // integration's insertOne adds `_id` to it. Whichever runs first, the NDJSON
  // line must not carry it.
  describe('with the mongodb integration sharing the reading', () => {
    it('never writes the _id insertOne added', () => {
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      const shared = reading()
      shared._id = new ObjectId()

      publish(shared, DEVICE)

      const [line] = linesOf(dayFile('2026-09-28'))
      expect(JSON.parse(line)).not.toHaveProperty('_id')
      expect(JSON.parse(line)).toEqual(reading())
    })

    it('leaves the shared reading untouched for the integrations after it', () => {
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      const shared = reading()
      const id = new ObjectId()
      shared._id = id

      publish(shared, DEVICE)

      expect(shared._id).toBe(id)
      expect(shared).toEqual({...reading(), _id: id})
    })
  })

  it('keeps two services that write the same stream in separate files', () => {
    const monitoring = createNdjsonIntegration({root, stream: 'monitoring', service: 'monitoring'})
    const solar = createNdjsonIntegration({root, stream: 'monitoring', service: 'solar'})

    monitoring.publish({...reading(), device: 'solar_heater'}, DEVICE)
    solar.publish({...reading(), device: 'sr04'}, DEVICE)

    expect(linesOf(dayFile('2026-09-28', 'monitoring', 'monitoring'))).toHaveLength(1)
    expect(linesOf(dayFile('2026-09-28', 'monitoring', 'solar'))).toHaveLength(1)
  })

  // A raw directory the service cannot write (docker creates a missing bind
  // source owned by root) must stop the service at startup, where the deploy
  // gate and the restart loop show it, not drop every reading unnoticed.
  describe('at startup', () => {
    it('creates the stream directory', () => {
      createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})

      expect(fs.statSync(path.join(root, 'secondary')).isDirectory()).toBe(true)
    })

    it('throws when the stream directory cannot be written', () => {
      fs.writeFileSync(path.join(root, 'secondary'), '') // a file where the directory belongs

      expect(() => createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})).toThrow()
    })
  })

  describe('when a write fails', () => {
    // Makes every later write fail: a file where the stream directory was.
    const breakStream = () => {
      fs.rmSync(path.join(root, 'secondary'), {recursive: true, force: true})
      fs.writeFileSync(path.join(root, 'secondary'), '')
    }
    const repairStream = () => fs.rmSync(path.join(root, 'secondary'))

    it('logs it without throwing, so the other integrations still get the reading', () => {
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      breakStream()

      expect(() => publish(reading(), DEVICE)).not.toThrow()

      expect(errors).toHaveBeenCalledTimes(1)
      expect(errors.mock.calls[0].join(' ')).toContain('[ndjson]')
    })

    // Readings arrive many times a second; one log line per reading would push
    // everything else out of the rotated log.
    it('logs the same error once, not once per reading', () => {
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      breakStream()

      for (let i = 0; i < 20; i++) publish(reading(), DEVICE)

      expect(errors).toHaveBeenCalledTimes(1)
    })

    it('logs when writing works again, and logs the next failure again', () => {
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      breakStream()
      publish(reading(), DEVICE)
      publish(reading(), DEVICE)

      repairStream()
      publish({...reading(), p: 1}, DEVICE)
      publish({...reading(), p: 2}, DEVICE)
      breakStream()
      // The next day's first reading has to open a new file in the broken place.
      publish({...reading(), _tz: Date.UTC(2026, 8, 29, 0, 0, 1)}, DEVICE)

      expect(errors).toHaveBeenCalledTimes(2)
      expect(logs).toHaveBeenCalledTimes(1)
      expect(logs.mock.calls[0].join(' ')).toContain('[ndjson]')
    })

    it('writes the next reading once the fault is gone', () => {
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      breakStream()
      publish(reading(), DEVICE)

      repairStream()
      publish({...reading(), p: 1}, DEVICE)

      expect(linesOf(dayFile('2026-09-28')).map((line) => JSON.parse(line).p)).toEqual([1])
    })
  })

  describe('configuration', () => {
    it.each([
      ['root', {stream: 'secondary', service: 'secondary-power'}],
      ['stream', {root: '/tmp', service: 'secondary-power'}],
      ['service', {root: '/tmp', stream: 'secondary'}],
    ])('fails at startup when %s is missing', (name, config) => {
      expect(() => createNdjsonIntegration(config)).toThrow(name)
    })
  })

  it('names itself ndjson in logs', () => {
    const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})

    expect(String(publish)).toBe('ndjson')
  })
})
