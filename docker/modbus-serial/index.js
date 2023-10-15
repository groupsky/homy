#!/usr/bin/env node
/* eslint-env node */
const { Mutex, withTimeout } = require('async-mutex')
const ModbusRTU = require('modbus-serial')
const {
  modbus: {
    type = 'rtu', // 'rtu' or 'tcp'
    port,
    portConfig,
    msDelayBetweenDevices = 150,
    msTimeout = 1000,
    msCommunicationTimeout = msTimeout * 10,
  },
  devices: devicesConfig,
  integrations: integrationsConfig,
} = require(process.env.CONFIG)
const modbusClient = new ModbusRTU()
const modbusMutex = withTimeout(new Mutex(), msCommunicationTimeout)

const devices = devicesConfig.map((deviceConfig) => ({
  config: deviceConfig,
  driver: require(`./devices/${deviceConfig.type}`),
  name: deviceConfig.name,
  state: {}
}))

const integrations = Object.entries(integrationsConfig).map(
  ([integrationName, integrationConfig]) => {
    const integration = require(`./integrations/${integrationName}`)(integrationConfig)
    return {
      client: integration,
      config: integrationConfig,
      name: integrationName
    }
  }
)

const pollDevice = async (device) => {
  let val = null
  let start
  let end
  await modbusMutex.runExclusive(async () => {
    await modbusClient.setID(device.config.address)
    start = Date.now()
    try {
      val = await device.driver.read(modbusClient, device.config, device.state)
    } catch (e) {
      console.error(`Error reading from ${device.name}`, e)
    }
    end = Date.now()
  })
  if (val == null) return
  val._tz = Math.round((start + end) / 2)
  val._ms = end - start
  val._addr = device.config.address
  val._type = device.config.type
  val.device = device.name
  integrations.forEach(({client, name}) => {
    try {
      client.publish(val, device)
    } catch (e) {
      console.error(`Error publishing to ${name}`)
    }
  })
}

const poll = async () => {
  try {
    // get value of all meters
    for (const device of devices) {
      await pollDevice(device)
      await sleep(msDelayBetweenDevices)
    }
  } catch (e) {
    // if error, handle them here (it should not)
    console.error(e)
  } finally {
    // after get all data from slave repeat it again
    setImmediate(poll)
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

Promise.all([
  type === 'tcp'
      ? modbusClient.connectTCP(port, portConfig)
      : modbusClient.connectRTUBuffered(port, portConfig)
]).then(async () => {
  modbusClient.setTimeout(msTimeout)

  for (const integration of integrations) {
    if (integration.client.subscribe) {
      for (const device of devices) {
        if (device.driver.write) {
          await integration.client.subscribe(device, async (message) => {
            await modbusMutex.runExclusive(async () => {
              await modbusClient.setID(device.config.address)
              try {
                await device.driver.write(modbusClient, message, device.config, device.state)
              } catch (e) {
                console.error(`Error writing to device ${device.name}`, message, e)
              }
            })
            await pollDevice(device)
          })
        }
      }
    }
  }

  return poll()
})
