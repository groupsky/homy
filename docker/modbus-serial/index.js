#!/usr/bin/env node
/* eslint-env node */
const { Mutex, withTimeout } = require('async-mutex')
const ModbusRTU = require('modbus-serial')
const readWithRetry = require('./read-with-retry')
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
let modbusClient
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

const deviceErrors = new Map()

// Wait before each reconnect: 5 s, doubled after each failure, at most 60 s.
// Reset by the next good read.
const msReconnectDelayMin = 5000
const msReconnectDelayMax = 60000
let msReconnectDelay = 0

// Each connect uses a new client, so a new connection starts as clean as the
// first one: no stale transactions or listeners from the old port.
const connect = async () => {
  modbusClient = new ModbusRTU()
  if (type === 'tcp') {
    await modbusClient.connectTCP(port, portConfig)
  } else {
    await modbusClient.connectRTUBuffered(port, portConfig)
  }
  modbusClient.setTimeout(msTimeout)
}

// Closes the port and opens it again, inside the process. Exiting instead
// let Docker restart the service, and each restart lost minutes of readings
// (#1368). destroy() closes a TCP socket at once, so the old session is gone
// before the new one opens: the SUN2000 allows only one. A serial port has
// no destroy(), so it is closed.
// It runs while its caller holds modbusMutex. pollDevice waits for a running
// reconnect before it asks for the mutex, so the poll loop does not time out
// on the mutex again and again while an MQTT write's poll reconnects.
let reconnecting = null
const reconnect = () => {
  reconnecting = reconnecting || reconnectLoop().finally(() => { reconnecting = null })
  return reconnecting
}

const reconnectLoop = async () => {
  for (;;) {
    const oldClient = modbusClient
    await new Promise((resolve) => type === 'tcp' ? oldClient.destroy(resolve) : oldClient.close(resolve))
    msReconnectDelay = Math.min(Math.max(msReconnectDelay * 2, msReconnectDelayMin), msReconnectDelayMax)
    console.error(`Reconnecting in ${msReconnectDelay} ms`)
    await sleep(msReconnectDelay)
    try {
      await connect()
      console.error('Reconnected')
      return
    } catch (e) {
      console.error('Failed to reconnect', e)
    }
  }
}

const pollDevice = async (device) => {
  let val = null
  let start
  let end
  if (reconnecting) await reconnecting
  await modbusMutex.runExclusive(async () => {
    await modbusClient.setID(device.config.address)
    start = Date.now()
    try {
      // Only reads are retried; writes go through the MQTT handler below.
      val = await readWithRetry(
        (force) => device.driver.read(modbusClient, device.config, device.state, force),
        {onRetry: (e) => console.error(`Retrying read from ${device.name} after: ${e.message}`)}
      )
      deviceErrors.delete(device.name)
      msReconnectDelay = 0
    } catch (e) {
      console.error(`Error reading from ${device.name}`, e)
      // The port is closed (the peer dropped the TCP session): every read
      // fails at once until it is opened again.
      if (e.name === 'PortNotOpenError') {
        deviceErrors.clear()
        await reconnect()
        return
      }
      if (!deviceErrors.has(device.name)) {
        deviceErrors.set(device.name, {error: e, counter: 1})
        return
      }
      const {error: prevError, counter} = deviceErrors.get(device.name)
      if (prevError.message !== e.message || prevError?.errno !== e?.errno) {
        deviceErrors.set(device.name, {error: e, counter: 1})
        return
      }

      if (counter < 10) {
        deviceErrors.set(device.name, {error: e, counter: counter + 1})
        return
      }

      console.error('Too many errors, reconnecting', e)
      deviceErrors.clear()
      await reconnect()
      return
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

connect().then(async () => {
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
