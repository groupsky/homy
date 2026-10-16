const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')
const createConsoleIntegration = require('./console')

const DEVICE = {name: 'stab-em'}

const reading = () => ({
  serialNumber: 0,
  address: 77,
  v: 230.1,
  _tz: Date.UTC(2026, 9, 16, 8, 0),
  _ms: 42,
  _addr: 77,
  _type: 'dds519mr',
  device: 'stab-em',
})

let logs
let errors
let savedMode

beforeEach(() => {
  savedMode = process.env.MODBUS_CONSOLE
  delete process.env.MODBUS_CONSOLE
  logs = jest.spyOn(console, 'log').mockImplementation(() => {})
  errors = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (savedMode === undefined) delete process.env.MODBUS_CONSOLE
  else process.env.MODBUS_CONSOLE = savedMode
})

describe('console integration', () => {
  it('logs nothing by default', () => {
    createConsoleIntegration({}).publish(reading(), DEVICE)

    expect(logs).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
  })

  it('logs nothing when MODBUS_CONSOLE=off', () => {
    process.env.MODBUS_CONSOLE = 'off'
    createConsoleIntegration({}).publish(reading(), DEVICE)

    expect(logs).not.toHaveBeenCalled()
  })

  it('logs one line per reading when MODBUS_CONSOLE=line', () => {
    process.env.MODBUS_CONSOLE = 'line'
    createConsoleIntegration({}).publish(reading(), DEVICE)

    expect(logs).toHaveBeenCalledTimes(1)
    const [line] = logs.mock.calls[0]
    expect(typeof line).toBe('string')
    expect(line).not.toContain('\n')
    expect(line).toBe(`[stab-em]: ${JSON.stringify(reading())}`)
  })

  it('logs the whole object when MODBUS_CONSOLE=full', () => {
    process.env.MODBUS_CONSOLE = 'full'
    createConsoleIntegration({}).publish(reading(), DEVICE)

    expect(logs).toHaveBeenCalledWith('[stab-em]:', reading())
  })

  it('reports an unknown mode once and logs nothing', () => {
    process.env.MODBUS_CONSOLE = 'verbose'
    const integration = createConsoleIntegration({})
    integration.publish(reading(), DEVICE)
    integration.publish(reading(), DEVICE)

    expect(logs).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0].join(' ')).toContain('MODBUS_CONSOLE')
  })
})
