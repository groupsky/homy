#!/usr/bin/env node
/* eslint-env node */
const { Mutex, withTimeout } = require('async-mutex')
const ModbusRTU = require('modbus-serial')
const readWithRetry = require('./read-with-retry')
const { createPowerDipGuard } = require('./power-dip-guard')
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
  powerDipGuard: powerDipGuardConfig,
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

const publish = (val, device, skip = []) => {
  integrations.forEach(({client, name}) => {
    if (skip.includes(name)) return
    try {
      client.publish(val, device)
    } catch (e) {
      console.error(`Error publishing to ${name}`)
    }
  })
}

// Optional, per bus: holds back the readings of input modules that restart
// in a power dip (#2007, see power-dip-guard.js). Without it every reading is
// published at once.
const powerDipDevice = {name: 'power-dip', config: {type: 'power-dip'}}
const powerDipGuard = powerDipGuardConfig ? createPowerDipGuard(powerDipGuardConfig, {
  publishReading: publish,
  // The bus's own influxdb measurement holds device readings only; the dip
  // event reaches InfluxDB through mqtt-influx (measurement power_dip).
  publishEvent: (event) => publish(event, powerDipDevice, ['influxdb']),
}) : null
for (const name of powerDipGuardConfig?.devices || []) {
  if (!devices.some((device) => device.name === name)) {
    throw new Error(`powerDipGuard: no device named ${name}`)
  }
}
const isGuarded = (device) => powerDipGuard != null && powerDipGuard.has(device.name)

const deviceErrors = new Map()

// Set when the service is stopping: the poll loop does not start another round.
let stopped = false

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

// Reads in progress, so a stop can wait until their points are published.
const reading = new Set()
const pollDevice = (device) => {
  // Also stops the reads that an MQTT command starts after the stop: their
  // points would be published after the final flush began (#1971).
  if (stopped) return Promise.resolve()
  const promise = pollDeviceNow(device).finally(() => reading.delete(promise))
  reading.add(promise)
  return promise
}

const pollDeviceNow = async (device) => {
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

      // Since #1368 this path reconnects inside the process and does not
      // exit, so the points in the InfluxDB batch stay in memory and are sent
      // with the next batch. No flush is needed here (#1971).
      console.error('Too many errors, reconnecting', e)
      deviceErrors.clear()
      await reconnect()
      return
    }
    end = Date.now()
  })
  if (isGuarded(device)) {
    // The guard must see every read, also a failed one or one with no change.
    if (end === undefined) {
      powerDipGuard.onReadError(device, Date.now())
    } else {
      powerDipGuard.onRead(device, val, readingMeta(device, start, end))
    }
    return
  }
  if (val == null) return
  publish(Object.assign(val, readingMeta(device, start, end)), device)
}

const readingMeta = (device, start, end) => ({
  _tz: Math.round((start + end) / 2),
  _ms: end - start,
  _addr: device.config.address,
  _type: device.config.type,
  device: device.name,
})

const poll = async () => {
  try {
    // get value of all meters
    for (const device of devices) {
      if (stopped) break
      await pollDevice(device)
      await sleep(msDelayBetweenDevices)
    }
  } catch (e) {
    // if error, handle them here (it should not)
    console.error(e)
  } finally {
    // after get all data from slave repeat it again
    if (!stopped) setImmediate(poll)
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

// Node as PID 1 ignores SIGTERM unless it has a handler, so `docker stop`
// waited out the grace period and then killed the service (#1680). The raw
// file is written with writeSync, so nothing in it is lost, and the OS closes
// the port and the files. Points still in the InfluxDB batch are sent first
// (#1971): the integrations' close() flushes them, with a timeout.
const shutdown = require('./shutdown')({
  integrations,
  stopPolling: () => {
    stopped = true
    return Promise.allSettled([...reading])
  },
})
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
