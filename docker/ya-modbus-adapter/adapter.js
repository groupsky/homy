/**
 * Turns the data messages of the ya-modbus bridge back into the readings of
 * the old reader (docker/modbus-serial), so no consumer has to change.
 *
 * The bridge publishes `<topicPrefix>/<deviceId>/data` with
 * `{deviceId, timestamp, data: {<data point id>: value}}`. For each one this
 * writes the three outputs of the old reader:
 *
 * - MQTT: the reading on the old topic, QoS 0, not retained;
 * - NDJSON: the same reading as one line of the day file;
 * - MongoDB: the same reading as one document (only while Mongo is
 *   configured; it is being retired, issue #1622).
 *
 * The reading has the old field names, in the old order, then `_tz` (the
 * message timestamp), `_addr`, `_type` and `device`. There is no `_ms`: the
 * bridge does not publish the read time.
 *
 * A device of a new driver needs only a table in mappings/<type>.js, where
 * the type is the driver package name without `@ya-modbus/driver-`.
 */

const DRIVER_PREFIX = '@ya-modbus/driver-'

// The bridge's own default (packages/mqtt-bridge README, `topicPrefix`).
const DEFAULT_TOPIC_PREFIX = 'modbus'

function loadMapping(type) {
  try {
    return require(`./mappings/${type}`)
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null
    throw err
  }
}

/**
 * The devices of a bridge config file, each with its data topic, address,
 * old reader type and field mapping. Throws on a driver without a mapping,
 * so the adapter does not start and silently drop that device.
 */
function devicesFromBridgeConfig(config) {
  if (!Array.isArray(config?.devices) || config.devices.length === 0) {
    throw new Error('the bridge config has no devices')
  }
  const prefix = config.topicPrefix ?? DEFAULT_TOPIC_PREFIX
  return config.devices.map(({deviceId, driver, connection}) => {
    const type = typeof driver === 'string' && driver.startsWith(DRIVER_PREFIX)
      ? driver.slice(DRIVER_PREFIX.length)
      : null
    const mapping = type && /^[a-z0-9-]+$/.test(type) ? loadMapping(type) : null
    if (!mapping) {
      throw new Error(`device ${deviceId}: no mapping for driver ${driver} (expected mappings/<type>.js)`)
    }
    return {name: deviceId, address: connection?.slaveId, type, mapping, topic: `${prefix}/${deviceId}/data`}
  })
}

/** The old reader's reading for one bridge data message. */
function toReading(message, device) {
  const reading = {}
  for (const [field, id] of Object.entries(device.mapping)) {
    // A data point the message does not have is left out, not set to
    // undefined: undefined would be null in Mongo and missing in JSON.
    if (Object.prototype.hasOwnProperty.call(message.data, id)) reading[field] = message.data[id]
  }
  reading._tz = message.timestamp
  reading._addr = device.address
  reading._type = device.type
  reading.device = device.name
  return reading
}

function parseMessage(payload) {
  const message = JSON.parse(payload.toString())
  if (typeof message?.timestamp !== 'number' || !Number.isFinite(message.timestamp)) {
    throw new Error('no numeric timestamp')
  }
  if (message.data === null || typeof message.data !== 'object' || Array.isArray(message.data)) {
    throw new Error('no data object')
  }
  return message
}

/**
 * The MQTT message handler.
 *
 * @param devices from devicesFromBridgeConfig
 * @param publishTopic the old topic; `{name}` is replaced by the device name
 * @param publish (topic, payload) => void, the MQTT publish
 * @param writer the day-file writer
 * @param insert (document) => Promise, the Mongo insert; null without Mongo
 */
function createAdapter({devices, publishTopic, publish, writer, insert}) {
  const byTopic = new Map(devices.map((device) => [device.topic, device]))
  // Message of the NDJSON error being reported, or null while writes work.
  let ndjsonFailing = null

  return function handle(topic, payload) {
    const device = byTopic.get(topic)
    if (!device) return

    let message
    try {
      message = parseMessage(payload)
    } catch (err) {
      console.error(`[adapter] skipped a message on ${topic}: ${err.message}`)
      return
    }
    const reading = toReading(message, device)

    publish(publishTopic.replace(/\{name\}/g, device.name), JSON.stringify(reading))

    // Same rules as the old reader's ndjson integration: a failed write is
    // logged once, and must not stop the other outputs.
    try {
      writer.write(reading, reading._tz)
      if (ndjsonFailing !== null) {
        ndjsonFailing = null
        console.log('[adapter] writing NDJSON works again')
      }
    } catch (err) {
      if (err.message !== ndjsonFailing) {
        ndjsonFailing = err.message
        console.error(`[adapter] failed to write a reading of ${device.name}; further identical errors are not logged`, err)
      }
    }

    // insertOne adds `_id` to the object it gets, so it gets its own copy.
    if (insert) {
      const reportInsertError = (err) => console.error('[adapter] failed to insert a reading into MongoDB', err)
      try {
        Promise.resolve(insert({...reading})).catch(reportInsertError)
      } catch (err) {
        reportInsertError(err)
      }
    }
  }
}

module.exports = {createAdapter, devicesFromBridgeConfig, toReading}
