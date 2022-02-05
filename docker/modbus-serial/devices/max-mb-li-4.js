// https://www.fif.com.pl/en/time-impulse-meters/560-pulse-counter-mb-li-4-lo.html

/**
 * @typedef {1200|2400|4800|9600|19200|38400|57600|115200} BAUD_RATE
 */

/**
 * @typedef {'none'|'even'|'odd'} PARITY
 */

/**
 * @typedef {1|1.5|2} STOP_BITS
 */

/**
 * @typedef {'Lo'|'Hi'} COMPLETION
 */

/**
 * @typedef {'leading'|'trailing'} EDGE
 */

/**
 * @typedef {{
 *   input: boolean,
 *   raw: number,
 *   value: number,
 * }} COUNTER_VALUE
 */

/**
 * @typedef {{
 *   [minPulseTime]: number,
 *   [edge]: EDGE,
 *   [multiplier]: number,
 *   [divisor]: number,
 * }} COUNTER_CONFIGURATION
 */

/**
 * @typedef {{
 *   completion: COMPLETION,
 *   identifier: "F&F MB-4LI",
 *   configurationJumper: boolean,
 *   serialNumber: number,
 *   productionDate: `${number}-${number}-${number}`,
 *   softwareVersion: number,
 *   uptime: number
 * }} DEVICE_INFO
 */

/**
 * @typedef {{
 *   [read]: {
 *     [counter1]: boolean,
 *     [counter2]: boolean,
 *     [counter3]: boolean,
 *     [counter4]: boolean,
 *     [configuration]: boolean,
 *     [device]: boolean,
 *   },
 *   [options]: {
 *     [maxMsBetweenReports]: number,
 *   }
 * }} CONFIG
 */

/**
 * @typedef {{
 *   [lastReport]: number,
 *   [counter1]: COUNTER_VALUE,
 *   [counter2]: COUNTER_VALUE,
 *   [counter3]: COUNTER_VALUE,
 *   [counter4]: COUNTER_VALUE,
 * }} STATE
 */

/**
 * @type {Object<string, BAUD_RATE>}
 */
const READ_BAUD_RATE_MAP = {
  0: 1200,
  1: 2400,
  2: 4800,
  3: 9600,
  4: 19200,
  5: 38400,
  6: 57600,
  7: 115200,
}
/**
 * @type {Object<BAUD_RATE, number>}
 */
const WRITE_BAUD_RATE_MAP = {
  1200: 0,
  2400: 1,
  4800: 2,
  9600: 3,
  19200: 4,
  38400: 5,
  57600: 6,
  115200: 7,
}

/**
 * @type {Object<string, PARITY>}
 */
const READ_PARITY_MAP = {
  0: 'none',
  1: 'even',
  2: 'odd',
}
/**
 * @type {Object<PARITY, number>}
 */
const WRITE_PARITY_MAP = {
  none: 0,
  even: 1,
  odd: 2,
}

/**
 * @type {Object<string, STOP_BITS>}
 */
const READ_STOP_BITS_MAP = {
  0: 1,
  1: 1.5,
  2: 2,
}
/**
 * @type {Object<STOP_BITS, number>}
 */
const WRITE_STOP_BITS_MAP = {
  1: 0,
  1.5: 1,
  2: 2,
}

/**
 * @type {Object<string, COMPLETION>}
 */
const READ_COMPLETION_MAP = {
  0: 'Lo',
  1: 'Hi',
}

/**
 * @type {Object<string, EDGE>}
 */
const READ_EDGE_MAP = {
  0: 'trailing',
  1: 'leading',
}
/**
 * @type {Object<EDGE, number>}
 */
const WRITE_EDGE_MAP = {
  trailing: 0,
  leading: 1,
}

/**
 * @param {COUNTER_VALUE} v1
 * @param {COUNTER_VALUE} v2
 * @return {boolean}
 */
const counterValuesEqual = (v1, v2) => {
  if (v1 === v2) return true
  if (v1 && !v2) return false
  return v1.input === v2.input && v1.raw === v2.raw && v1.value === v2.value
}

/**
 * @param {number} val
 * @return {BAUD_RATE}
 */
const readBaudRate = (val) => READ_BAUD_RATE_MAP[val]
/**
 * @param {BAUD_RATE} val
 * @return {number}
 */
const writeBaudRate = (val) => WRITE_BAUD_RATE_MAP[val]

/**
 * @param {number} val
 * @return {PARITY}
 */
const readParity = (val) => READ_PARITY_MAP[val]
/**
 * @param {PARITY} val
 * @return {number}
 */
const writeParity = (val) => WRITE_PARITY_MAP[val]

/**
 * @param {number} val
 * @return {STOP_BITS}
 */
const readStopBits = (val) => READ_STOP_BITS_MAP[val]
/**
 * @param {STOP_BITS} val
 * @return {number}
 */
const writeStopBits = (val) => WRITE_STOP_BITS_MAP[val]

/**
 * @param {number} lsb
 * @param {number} msb
 * @return {number}
 */
const readLong = (lsb, msb) => msb << 16 | lsb
/**
 * @param {number} value
 * @return {Array<number>}
 */
const writeLong = (value) => [value & 0xFFFF, value >> 16]

/**
 * @param {number} value
 * @return {`${number}-${number}-${number}`}
 */
const readDate = (value) => `${(value & 0x7F) + 2000}-${(value >> 7) & 0x0F}-${(value >> 11) & 0x1F}`

/**
 * @param {number} val
 * @return {COMPLETION}
 */
const readCompletion = (val) => READ_COMPLETION_MAP[val]
/**
 * @param {...number} words
 * @return {string}
 */
const readIdentifier = (...words) => String.fromCharCode(...words.flatMap((word) => [word >> 8, word & 0xFF]))
/**
 * @param {number} val
 * @return {boolean}
 */
const readBool = (val) => !!val
/**
 * @param {number} val
 * @return {EDGE}
 */
const readEdge = (val) => READ_EDGE_MAP[val]
/**
 * @param {EDGE} val
 * @return {number}
 */
const writeEdge = (val) => WRITE_EDGE_MAP[val]

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {number} startRegister
 * @return {Promise<COUNTER_VALUE>}
 */
async function readCounter(client, startRegister) {
  const {data} = await client.readHoldingRegisters(startRegister, 9)

  const input = readBool(data[0])

  // raw counter value
  const raw = readLong(data[1], data[2])

  // rescaled value
  const value = readLong(data[5], data[6]) + readLong(data[7], data[8]) / 1000000

  return { input, raw, value }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @return {Promise<DEVICE_INFO>}
 */
async function readDevice(client) {
  const {data} = await client.readHoldingRegisters(1024, 16)

  // Module operation time [s]
  const uptime = readLong(data[0], data[1])
  const serialNumber = readLong(data[2], data[3])
  const productionDate = readDate(data[4])
  const softwareVersion = data[5]
  const completion = readCompletion(data[6])
  // Always "F&F MB-4LI"
  const identifier = readIdentifier(data[7], data[8], data[9], data[10], data[11])
  const configurationJumper = readBool(data[15])

  return {
    uptime,
    serialNumber,
    productionDate,
    softwareVersion,
    completion,
    identifier,
    configurationJumper
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {number} startRegister
 * @return {Promise<COUNTER_CONFIGURATION>}
 */
async function readCounterConfiguration(client, startRegister) {
  const { data } = await client.readHoldingRegisters(startRegister, 4)

  // min. pulse time [ms]. Range 1÷15000
  const minPulseTime = data[0]
  // logika. 0: trailing edge ; 1: leading edge
  const edge = readEdge(data[1])
  // multiplier. Range 1÷10000
  const multiplier = data[2]
  // divisor. Range 1÷10000
  const divisor = data[3]

  return {
    minPulseTime,
    edge,
    multiplier,
    divisor,
  }
}

/**
 *
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {number} startRegister
 * @param {COUNTER_CONFIGURATION} configuration
 * @return {Promise<void>}
 */
async function writeCounterConfiguration(client, startRegister, configuration) {
  if (configuration.minPulseTime) {
    // noinspection PointlessArithmeticExpressionJS
    await client.writeRegister(startRegister+0, configuration.minPulseTime)
  }
  if (configuration.edge) {
    await client.writeRegister(startRegister+1, writeEdge(configuration.edge))
  }
  if (configuration.multiplier) {
    await client.writeRegister(startRegister+2, configuration.multiplier)
  }
  if (configuration.divisor) {
    await client.writeRegister(startRegister+3, configuration.divisor)
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @return {Promise<{
 *   counter1: COUNTER_CONFIGURATION,
 *   counter2: COUNTER_CONFIGURATION,
 *   counter3: COUNTER_CONFIGURATION,
 *   counter4: COUNTER_CONFIGURATION,
 * }>}
 */
async function readConfiguration(client) {
  return {
    counter1: await readCounterConfiguration(client, 512),
    counter2: await readCounterConfiguration(client, 528),
    counter3: await readCounterConfiguration(client, 544),
    counter4: await readCounterConfiguration(client, 560),
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<Object>}
 */
async function read (
  client, {
    read: {
      counter1 = true,
      counter2 = true,
      counter3 = true,
      counter4 = true,
      configuration = true,
      device = true,
    } = {},
    options: {
      maxMsBetweenReports = 1000,
    } = {}
  } = {},
  state = {}
) {
  const result = {}
  let changed = false

  if (counter1) {
    result.counter1 = await readCounter(client, 16)
    changed |= !counterValuesEqual(result.counter1, state.counter1)
  }
  if (counter2) {
    result.counter2 = await readCounter(client, 32)
    changed |= !counterValuesEqual(result.counter2, state.counter2)
  }
  if (counter3) {
    result.counter3 = await readCounter(client, 48)
    changed |= !counterValuesEqual(result.counter3, state.counter3)
  }
  if (counter4) {
    result.counter4 = await readCounter(client, 64)
    changed |= !counterValuesEqual(result.counter4, state.counter4)
  }

  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (state.lastReport > 0 && !changed && recentReport) {
    return
  }

  state.lastReport = Date.now()
  if (counter1) {
    state.counter1 = result.counter1
  }
  if (counter2) {
    state.counter2 = result.counter2
  }
  if (counter3) {
    state.counter3 = result.counter3
  }
  if (counter4) {
    state.counter4 = result.counter4
  }

  if (device) {
    result.device = await readDevice(client)
  }
  if (configuration) {
    result.configuration = await readConfiguration(client)
  }

  return result
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   counter1: COUNTER_CONFIGURATION,
 *   counter2: COUNTER_CONFIGURATION,
 *   counter3: COUNTER_CONFIGURATION,
 *   counter4: COUNTER_CONFIGURATION,
 *   factoryReset: boolean,
 *   resetCounter1: boolean,
 *   resetCounter2: boolean,
 *   resetCounter3: boolean,
 *   resetCounter4: boolean,
 * }} values
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @returns {Promise<void>}
 */
async function write (client, values= {}, config= {}, state = {}) {
  if (values.counter1) {
    await writeCounterConfiguration(client, 512, values.counter1)
  }
  if (values.counter2) {
    await writeCounterConfiguration(client, 528, values.counter2)
  }
  if (values.counter3) {
    await writeCounterConfiguration(client, 544, values.counter3)
  }
  if (values.counter4) {
    await writeCounterConfiguration(client, 560, values.counter4)
  }
  if (values.factoryReset) {
    await client.writeRegister(260, 1)
  }
  if (values.resetCounter1) {
    await client.writeRegister(31, 0)
  }
  if (values.resetCounter2) {
    await client.writeRegister(47, 0)
  }
  if (values.resetCounter3) {
    await client.writeRegister(63, 0)
  }
  if (values.resetCounter4) {
    await client.writeRegister(79, 0)
  }
}

/**
 * Setup communication parameters - changes are applied after device restart
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [address]: number,
 *   [baudRate]: (1200|2400|4800|9600|19200|38400|57600|115200),
 *   [parity]: ('none'|'even'|'odd'),
 *   [stopBits]: (1|1.5|2),
 * }} newConfig
 * @return {Promise<void>}
 */
async function setup (client, newConfig) {
  if (newConfig.baudRate != null) {
    await client.writeRegister(257, writeBaudRate(newConfig.baudRate))
  }
  if (newConfig.parity != null) {
    await client.writeRegister(258, writeParity(newConfig.parity))
  }
  if (newConfig.stopBits != null) {
    await client.writeRegister(259, writeStopBits(newConfig.stopBits))
  }
  // address is changed immediately
  if (newConfig.address) {
    await client.writeRegister(256, newConfig.address)
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @return {Promise<void>}
 */
async function factoryReset (client) {
  await client.writeRegister(260, 1)
}

module.exports = {
  read,
  write,
  setup,
  factoryReset,
}

