#!/usr/bin/env node
/* eslint-env node */
const ModbusRTU = require('modbus-serial')
const MongoClient = require('mongodb').MongoClient

const url = process.env.DATABASE
const collection = process.env.COLLECTION
const { port, devices, ...portConfig } = require(process.env.CONFIG)
const modbusClient = new ModbusRTU()

const readers = devices.reduce((map, {reader}) => {
  if (!(reader in map)) {
    map[reader] = require(`./readers/${reader}`)
  }
  return map
}, {})

let col

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
        console.log(`[${device.name}]:`, val)
        if (col) {
          col.insert(val)
        }
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
  MongoClient.connect(url),
  modbusClient.connectRTUBuffered(port, portConfig)
]).then(([mongoClient]) => {
  const db = mongoClient.db()
  col = db.collection(collection)
  modbusClient.setTimeout(1000)

  return getValues()
})
