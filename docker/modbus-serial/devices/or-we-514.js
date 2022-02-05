// https://orno.pl/en/product/1078/1-phase-energy-meter-with-rs-485-100a-rs-485-port-mid-1-module-din-th-35mm

// Unknown holding registers
// 0x6b03 [ 65281 ]
// 0xff00 [ 4826 ]
// 0xff01 [ 0 ]
// 0xff02 [ 256 ]
// 0xfff0 [ 0 ]

/**
 * @typedef {1200|2400|4800|9600} BAUD_RATE
 */

/**
 * @typedef {'none'|'even'|'odd'} PARITY
 */

/**
 * @typedef {{
 *   [read]: {
 *     [frequency]: boolean,
 *     [voltage]: boolean,
 *     [current]: boolean,
 *     [power]: boolean,
 *     [reactivePower]: boolean,
 *     [apparentPower]: boolean,
 *     [powerFactor]: boolean,
 *     [totalPower]: boolean,
 *     [totalReactivePower]: boolean,
 *   },
 *   [options]: {
 *     [maxMsBetweenReports]: number,
 *   }
 * }} CONFIG
 */

/**
 * @typedef {{
 *   [lastReport]: number,
 *   [freq]: number,
 *   [v]: number,
 *   [c]: number,
 *   [p]: number,
 *   [rp]: number,
 *   [ap]: number,
 *   [pow]: number,
 *   [tot_act]: number,
 *   [tot_react]: number,
 * }} STATE
 */

/**
 * @type {Object<string, BAUD_RATE>}
 */
const READ_BAUD_RATE_MAP = {
  1: 1200,
  2: 2400,
  3: 4800,
  4: 9600,
}
/**
 * @type {Object<BAUD_RATE, number>}
 */
const WRITE_BAUD_RATE_MAP = {
  1200: 1,
  2400: 2,
  4800: 3,
  9600: 4,
}

/**
 * @type {Object<string, PARITY>}
 */
const READ_PARITY_MAP = {
  1: 'none',
  2: 'odd',
  3: 'even',
}
/**
 * @type {Object<PARITY, number>}
 */
const WRITE_PARITY_MAP = {
  none: 1,
  odd: 2,
  even: 3,
}

/**
 * @param {number} val
 * @return {BAUD_RATE}
 */
const readBaudRate = (val) => READ_BAUD_RATE_MAP[val & 0xFF]
/**
 * @param {BAUD_RATE} val
 * @param {number} prev
 * @return {number}
 */
const writeBaudRate = (val, prev) => (prev & 0xFF00) | WRITE_BAUD_RATE_MAP[val]

/**
 * @param {number} val
 * @return {PARITY}
 */
const readParity = (val) => READ_PARITY_MAP[val >> 8]
/**
 * @param {PARITY} val
 * @param {number} prev
 * @return {number}
 */
const writeParity = (val, prev) => (prev & 0x00FF) | (WRITE_PARITY_MAP[val] << 8)

/**
 * @param {number} lsb
 * @param {number} msb
 * @return {number}
 */
const readLong = (msb, lsb) => msb << 16 | lsb
/**
 * @param {number} value
 * @return {Array<number>}
 */
const writeLong = (value) => [value & 0xFFFF, value >> 16]

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<Object>}
 */
async function read (
  client, {
    read: {
      frequency = true,
      voltage = true,
      current = true,
      power = true,
      reactivePower = true,
      apparentPower = true,
      powerFactor = true,
      totalPower = true,
      totalReactivePower = true,
    } = {},
    options: {
      maxMsBetweenReports = 1000,
    } = {}
  } = {},
  state = {}
) {
  const result = {}
  let changed = false

  if (frequency || voltage) {
    const { data } = await client.readHoldingRegisters(0x130, 2)
    // frequency in Hz
    result.freq = data[0] / 100
    // phase voltage in V
    result.v = data[1] / 100
    changed |= result.freq !== state.freq || result.v !== state.v
  }
  if (current) {
    const { data } = await client.readHoldingRegisters(0x139, 2)
    // phase current in A
    result.c = readLong(data[0], data[1]) / 1000
    changed |= result.c !== state.c
  }
  if (power) {
    const { data } = await client.readHoldingRegisters(0x140, 2)
    // active power in W
    result.p = readLong(data[0], data[1])
    changed |= result.p !== state.p
  }
  if (reactivePower) {
    const { data } = await client.readHoldingRegisters(0x148, 2)
    // reactive power in VAr
    result.rp = readLong(data[0], data[1])
    changed |= result.rp !== state.rp
  }
  if (apparentPower) {
    const { data } = await client.readHoldingRegisters(0x150, 2)
    // apparent power in VA
    result.ap = readLong(data[0], data[1])
    changed |= result.ap !== state.ap
  }
  if (powerFactor) {
    const { data } = await client.readHoldingRegisters(0x158, 1)
    // power factor
    result.pow = data[0] / 1000
    changed |= result.pow !== state.pow
  }
  if (totalPower) {
    const { data } = await client.readHoldingRegisters(0xA000, 2)
    // total active power in kWh
    result.tot_act = readLong(data[0], data[1]) / 100
    changed |= result.tot_act !== state.tot_act
  }
  if (totalReactivePower) {
    const { data } = await client.readHoldingRegisters(0xA01E, 2)
    // total reactive power in kVArh
    result.tot_react = readLong(data[0], data[1]) / 100
    changed |= result.tot_react !== state.tot_react
  }

  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (state.lastReport > 0 && !changed && recentReport) {
    return
  }

  state.lastReport = Date.now()
  if (frequency || voltage) {
    state.freq = result.freq
    state.v = result.v
  }
  if (current) {
    state.c = result.c
  }
  if (power) {
    state.p = result.p
  }
  if (reactivePower) {
    state.rp = result.rp
  }
  if (apparentPower) {
    state.ap = result.ap
  }
  if (powerFactor) {
    state.pow = result.pow
  }
  if (totalPower) {
    state.tot_act = result.tot_act
  }
  if (totalReactivePower) {
    state.tot_react = result.tot_react
  }

  return result
}

/**
 * Setup communication parameters - changes are applied after device restart
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [address]: number,
 *   [baudRate]: BAUD_RATE,
 *   [parity]: PARITY,
 * }} newConfig
 * @return {Promise<void>}
 */
async function setup (client, newConfig) {
  if (newConfig.address != null) {
    await client.writeRegisters(0x110, [newConfig.address])
    client.setID(newConfig.address)
  }
  if (newConfig.baudRate != null || newConfig.parity != null) {
    const { data } = await client.readHoldingRegisters(0x111, 1)
    if (newConfig.baudRate != null) {
      data[0] = writeBaudRate(newConfig.baudRate, data[0])
    }
    if (newConfig.parity != null) {
      data[0] = writeParity(newConfig.parity, data[0])
    }
    await client.writeRegisters(0x111, data)
  }
}

module.exports = {
  read,
  setup,
}

