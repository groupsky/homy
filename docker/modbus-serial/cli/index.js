#!/usr/bin/env node

const ModbusRTU = require('modbus-serial')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const withModbus = async (argv, callback) => {
  const modbusClient = new ModbusRTU()
  await modbusClient.connectRTUBuffered(argv.port, {
    baudRate: argv.baudRate,
    parity: argv.parity,
    stopBits: argv.stopBits,
    dataBits: argv.dataBits,
  })
  try {
    modbusClient.setTimeout(argv.timeout)
    modbusClient.setID(argv.id)
    await callback(modbusClient)
  } finally {
    await new Promise((resolve) => modbusClient.close(resolve))
  }
}

const getDeviceAction = (argv, action) => {
  const driver = require(`../devices/${argv.type}`)
  if (!driver[action]) {
    throw new Error(`Device ${argv.type} does not have ${action}!`)
  }
  return driver[action]
}

const getDeviceConfig = (argv) => yargs(argv._.slice(1)).parse()

yargs(hideBin(process.argv))
  .command('setup <type> [id] [port] -- --param=value ...', 'setup a device. Params after -- are values to write', (yargs) => {
    return yargs
  }, async (argv) => {
    await withModbus(argv, async (modbusClient) => {
      const setup = getDeviceAction(argv, 'setup')
      const deviceConfig = getDeviceConfig(argv)
      try {
        await setup(modbusClient, deviceConfig)
      } catch (e) {
        console.error(e)
        process.exit(1)
      }
    })
  })
  .command('read <type> [id] [port]', 'read from device', (yargs) => yargs, async (argv) => {
    await withModbus(argv, async (modbusClient) => {
      const read = getDeviceAction(argv, 'read')
      const deviceConfig = getDeviceConfig(argv)
      try {
        const _start = Date.now()
        const report = await read(modbusClient, deviceConfig, {})
        const _end = Date.now()
        console.log(report)
        console.error(`Read took ${_end - _start}ms`)
      } catch (e) {
        console.error(e)
        process.exit(1)
      }
    })
  })
  .command('write <type> [id] [port] -- --param=value ...', 'write to device. Params after -- are values to write', (yargs) => yargs, async (argv) => {
    await withModbus(argv, async (modbusClient) => {
      const write = getDeviceAction(argv, 'write')
      const deviceConfig = getDeviceConfig(argv)
      try {
        const report = await write(modbusClient, deviceConfig, {}, {})
        console.log(report)
      } catch (e) {
        console.error(e)
        process.exit(1)
      }
    })
  })
  .positional('type', {
    describe: 'modbus device type',
    type: 'string'
  })
  .positional('id', {
    describe: 'modbus device id [1-254] to communicate with',
    type: 'number',
    default: 1
  })
  .positional('port', {
    describe: 'serial port to use',
    type: 'string',
    default: '/dev/ttyUSB0'
  })
  .options({
    baudRate: {
      alias: 'b',
      description: 'Baud rate',
      type: 'number',
      default: 9600
    },
    parity: {
      alias: 'p',
      description: 'Parity',
      type: 'string',
      default: 'none'
    },
    stopBits: {
      alias: 's',
      description: 'Stop bits',
      type: 'number',
      default: 1
    },
    dataBits: {
      alias: 'd',
      description: 'Data bits',
      type: 'number',
      default: 8
    },
    timeout: {
      alias: 't',
      description: 'Response timeout',
      type: 'number',
      default: 1000
    }
  })
  .demandCommand()
  .help()
  .parse()
