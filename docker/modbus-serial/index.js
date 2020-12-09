#!/usr/bin/env node
/* eslint-env node */
const ModbusRTU = require('modbus-serial')
const { port, devices, writers: writersConfig, ...portConfig } = require(process.env.CONFIG)
const modbusClient = new ModbusRTU()

const readers = devices.reduce((map, { reader: readerName }) => {
  if (!(readerName in map)) {
    map[readerName] = require(`./readers/${readerName}`)
  }
  return map
}, {})
const writers = Object.entries(writersConfig).map(
  ([writerName, writerConfig]) => require(`./writers/${writerName}`)(writerConfig)
)

const getValues = async () => {
  try {
    // get value of all meters
    for (let device of devices) {
      // output value to console
      await modbusClient.setID(device.address)
      try {
        const reader = readers[device.reader]
        const start = Date.now()
        const val = await reader(modbusClient)
        val._tz = Date.now()
        val._ms = val._tz - start
        val._addr = device.address
        val._type = device.reader
        val.device = device.name
        writers.forEach((writer) => {
          try {
            writer(val, device)
          } catch (e) {
            console.error('Error writing', writer)
          }
        })
      } catch (e) {
        console.error('Error reading', device, e)
      }
      await sleep(150)
    }
  } catch (e) {
    // if error, handle them here (it should not)
    console.error(e)
  } finally {
    // after get all data from slave repeat it again
    setImmediate(getValues)
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

Promise.all([
  modbusClient.connectRTUBuffered(port, portConfig)
]).then(() => {
  modbusClient.setTimeout(1000)

  return getValues()
})
