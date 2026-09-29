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

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ndjson-integration-'))
  errors = jest.spyOn(console, 'error').mockImplementation(() => {})
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

  describe('when a write fails', () => {
    it('logs it without throwing, so the other integrations still get the reading', () => {
      // A file where the stream directory should be: every write fails.
      fs.writeFileSync(path.join(root, 'secondary'), '')
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})

      expect(() => publish(reading(), DEVICE)).not.toThrow()

      expect(errors).toHaveBeenCalledTimes(1)
      expect(errors.mock.calls[0].join(' ')).toContain('[ndjson]')
    })

    it('writes the next reading once the fault is gone', () => {
      fs.writeFileSync(path.join(root, 'secondary'), '')
      const {publish} = createNdjsonIntegration({root, stream: 'secondary', service: 'secondary-power'})
      publish(reading(), DEVICE)

      fs.rmSync(path.join(root, 'secondary'))
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
