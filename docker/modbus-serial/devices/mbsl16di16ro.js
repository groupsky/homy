/**
 * @typedef {{lastReport: number, inputs: number, outputs: number}} STATE
 */

/**
 * @typedef {{options: {maxMsBetweenReports: number }}} CONFIG
 */

/**
 * @param {Array<boolean>} array
 * @return number
 */
const boolArrayToNumber = (array) => {
  let number = 0
  for (let i = 0; i < array.length; i++) {
    if (array[i]) {
      number |= 1 << i
    }
  }
  return number
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<{outputs: number, inputs: number}|void>}
 */
async function read (client, { options: { maxMsBetweenReports = 0 } = {} } = {}, state = {}) {
  const inputsVal = await client.readHoldingRegisters(0x0000, 2)
  const outputsVal = await client.readCoils(0, 18)
  const newInputs = inputsVal.data[1] << 16 | inputsVal.data[0]
  const newOutputs = boolArrayToNumber(outputsVal.data)

  const noChange = (newInputs ^ state.inputs) === 0 && (newOutputs ^ state.outputs) === 0
  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (noChange && recentReport) {
    return
  }

  state.lastReport = Date.now()
  state.inputs = newInputs
  state.outputs = newOutputs

  return { inputs: newInputs, outputs: newOutputs }
}

const OUT_MAP = {
  out0: 0,
  out1: 1,
  out2: 2,
  out3: 3,
  out4: 4,
  out5: 5,
  out6: 6,
  out7: 7,
  out8: 8,
  out9: 9,
  out10: 10,
  out11: 11,
  out12: 12,
  // pcb track is too close to others, don't use it
  // out13: 13,
  out14: 14,
  // pcb track is too close to others, don't use it
  // out15: 15,
  // warning: pcb track is half the size of others
  out16half: 16,
  // pcb track is too close to others, don't use it
  // out17: 17,
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [out0]: boolean,
 *   [out1]: boolean,
 *   [out2]: boolean,
 *   [out3]: boolean,
 *   [out4]: boolean,
 *   [out5]: boolean,
 *   [out6]: boolean,
 *   [out7]: boolean,
 *   [out8]: boolean,
 *   [out9]: boolean,
 *   [out10]: boolean,
 *   [out11]: boolean,
 *   [out12]: boolean,
 *   [out14]: boolean,
 *   [out16half]: boolean,
 * }} values - out13, out15 and out17 has pcb tracks too close to others, out16 has half size pcb track
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @returns {Promise<void>}
 */
async function write (client, values, config, state= {}) {
  for (const key in OUT_MAP) {
    if (key in values) {
      await client.writeCoil(OUT_MAP[key], !!values[key])
      // force new report
      state.lastReport = 0
    }
  }
}

const BAUD_RATE_MAP = {
  4800: 1,
  9600: 2,
  19200: 3,
  38400: 4,
  57600: 5,
  115200: 6,
}

const PARITY_MAP = {
  none: 1,
  odd: 2,
  even: 3
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [address]: number,
 *   [baudRate]: (4800|9600|19200|38400|57600|115200),
 *   [parity]: ('none'|'odd'|'even'),
 *   [timeout]: number,
 * }} newConfig - timeout value greater or equal to 1800 disables timeout, otherwise after timeout without communication the outputs are reset
 * @return {Promise<void>}
 */
async function setup (client, newConfig) {
  if (newConfig.address) {
    await client.writeRegister(2, newConfig.address)
  }
  if (newConfig.baudRate) {
    await client.writeRegister(3, BAUD_RATE_MAP[newConfig.baudRate])
  }
  if (newConfig.parity) {
    await client.writeRegister(4, PARITY_MAP[newConfig.parity])
  }
  if (newConfig.timeout) {
    await client.writeRegister(5, newConfig.timeout)
  }
}

module.exports = {
  read,
  write,
  setup
}
