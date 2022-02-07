// https://www.autonics.com/series/3000394

/**
 * @typedef {'celsius'|'fahrenheit'} TEMPERATURE_UNIT
 */
/**
 * @typedef {'ntc5k-1'|'ntc5k-0.1'|'ntc10k-1'|'ntc10k-0.1'|'dpt100-1'|'dpt100-0.1'} INPUT_TYPE
 */
/**
 * @typedef {'di'|'temp'} INPUT3_TYPE
 */
/**
 * @typedef {'def'|'aux'} DEF_AUX_OUTPUT
 */
/**
 * @typedef {'off'|'fan'|'alarm'} AUX_OUTPUT
 */
/**
 * @typedef {'cooling'|'heating'} MODE
 */

/**
 * @typedef {{
 *   [auxEnabled]: boolean,
 *   [compEnabled]: boolean,
 *   [currentTemp]: number,
 *   [delay]: number,
 *   [inputs]: number,
 *   [lastReport]: number,
 *   [pg1]: Object,
 *   [pg2]: Object,
 *   [s1Temp]: number,
 *   [s2Temp]: number,
 *   [s3Temp]: number,
 *   [targetTemp]: number,
 *   [tempDivisor]: number,
 *   [temperatureUnit]: TEMPERATURE_UNIT,
 *   [virtualTemp]: number,
 * }} AUTONICS_TF3_STATE
 */

/**
 * @type {Object<number, TEMPERATURE_UNIT>}
 */
const READ_TEMPERATURE_UNIT_MAP = {
  0: 'celsius',
  1: 'fahrenheit',
}
/**
 * @type {Object<TEMPERATURE_UNIT, number>}
 */
const WRITE_TEMPERATURE_UNIT_MAP = {
  celsius: 0,
  fahrenheit: 1,
}

/**
 * @type {Object<number, number>}
 */
const TEMP_DIVISOR_MAP = {
  0: 1,
  1: 10,
}

/**
 * @type {Object<number, INPUT_TYPE>}
 */
const READ_INPUT_TYPE_MAP = {
  0: 'ntc5k-1',
  1: 'ntc5k-0.1',
  2: 'ntc10k-1',
  3: 'ntc10k-0.1',
  4: 'dpt100-1',
  5: 'dpt100-0.1',
}
/**
 * @type {Object<INPUT_TYPE, number>}
 */
const WRITE_INPUT_TYPE_MAP = {
  'ntc5k-1': 0,
  'ntc5k-0.1': 1,
  'ntc10k-1': 2,
  'ntc10k-0.1': 3,
  'dpt100-1': 4,
  'dpt100-0.1': 5
}

/**
 * @type {Object<number, INPUT3_TYPE>}
 */
const READ_INPUT3_TYPE_MAP = {
  0: 'di',
  1: 'temp',
}
/**
 * @type {Object<INPUT3_TYPE, number>}
 */
const WRITE_INPUT3_TYPE_MAP = {
  di: 0,
  temp: 1,
}

/**
 * @type {Object<number, DEF_AUX_OUTPUT>}
 */
const READ_DEF_AUX_OUTPUT_MAP = {
  0: 'def',
  1: 'aux',
}

/**
 * @type {Object<number, AUX_OUTPUT>}
 */
const READ_AUX_OUTPUT_MAP = {
  0: 'off',
  1: 'fan',
  2: 'alarm'
}

/**
 * @type {Object<number, MODE>}
 */
const READ_MODE_MAP = {
  0: 'cooling',
  1: 'heating',
}

/**
 * @type {Object<MODE, number>}
 */
const WRITE_MODE_MAP = {
  cooling: 0,
  heating: 1,
}

/**
 * @param {number} timeout
 * @return {Promise<void>}
 */
const sleep = (timeout) => new Promise(resolve => setTimeout(resolve, timeout))

/**
 * @param {number} val
 * @return {number}
 */
const readInt = (val) => val >> 15 ? val - 0x10000 : val

/**
 * @param {number} val
 * @return {number}
 */
const writeInt = (val) => val < 0 ? 0x10000 + val : val

/**
 * @param {number} msb
 * @param {number} lsb
 * @return {number}
 */
const readLong = (msb, lsb) => msb << 16 | lsb

/**
 * @param {...number} words
 * @return {string}
 */
const readIdentifier = (...words) => String.fromCharCode(...words.flatMap((word) => [word >> 8, word & 0xFF]))

/**
 * @param {number} val
 * @return {number}
 */
const readVersion = (val) => val

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{[delay]: number}} state
 * @param {boolean} force
 * @return {Promise<number>}
 */
const readDelay = async (client, state = {}, force = false) => {
  if (force || !state.delay) {
    const { data: [delay] } = await client.readHoldingRegisters(0x0134, 1)
    state.delay = delay
  }
  return state.delay
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{[delay]: number, [tempDivisor]: number}} state
 * @param {boolean} force
 * @return {Promise<number>}
 */
const readTempDivisor = async (client, state = {}, force = false) => {
  if (force || !state.tempDivisor) {
    await sleep(await readDelay(client, state))
    const { data: [tempDivisor] } = await client.readInputRegisters(0x03E8 + 12, 1)
    state.tempDivisor = TEMP_DIVISOR_MAP[tempDivisor]
  }
  return state.tempDivisor
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{[delay]: number, [device]: object}} state
 * @param {boolean} force
 * @return {Promise<{model: string, hardwareVersion: number, productNumber: number, softwareVersion: number}>}
 */
const readDevice = async (client, state = {}, force = false) => {
  if (force || !state.device) {
    await sleep(await readDelay(client, state))
    const { data } = await client.readInputRegisters(0x0064, 14)
    const productNumber = readLong(data[0], data[1])
    const hardwareVersion = readVersion(data[2])
    const softwareVersion = readVersion(data[3])
    const model = readIdentifier(...data.slice(4)).trim()
    state.device = {
      model,
      hardwareVersion,
      softwareVersion,
      productNumber
    }
  }
  return state.device
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{[delay]: number, [pg1]: object, [tempDivisor]: number}} state
 * @param {boolean} force
 * @return {Promise<{
 *   displayDelay: number,
 *   buzzer: boolean,
 *   temperatureUnit: TEMPERATURE_UNIT,
 *   input2Correction: number,
 *   inputType: INPUT_TYPE,
 *   virtualTempRate: number,
 *   input1Correction: number,
 *   auxOutput: AUX_OUTPUT,
 *   defAuxOutput: DEF_AUX_OUTPUT,
 *   input2Enabled: boolean,
 *   input3Type: INPUT3_TYPE,
 *   input3Correction: number
 * }>}
 */
const readPG1 = async (client, state = {}, force = false) => {
  if (force || !state.pg1) {
    await sleep(await readDelay(client, state))
    const tempDivisor = await readTempDivisor(client, state)
    const { data } = await client.readHoldingRegisters(0x64, 12)
    state.pg1 = {
      inputType: READ_INPUT_TYPE_MAP[data[0]],
      input2Enabled: !!data[1],
      input3Type: READ_INPUT3_TYPE_MAP[data[2]],
      virtualTempRate: data[3],
      temperatureUnit: READ_TEMPERATURE_UNIT_MAP[data[4]],
      input1Correction: readInt(data[5]) / tempDivisor,
      input2Correction: readInt(data[6]) / tempDivisor,
      input3Correction: readInt(data[7]) / tempDivisor,
      displayDelay: data[8] / 10,
      defAuxOutput: READ_DEF_AUX_OUTPUT_MAP[data[9]],
      auxOutput: READ_AUX_OUTPUT_MAP[data[10]],
      buzzer: !!data[11],
    }
  }
  return state.pg1
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{[delay]: number, [pg2]: object, [tempDivisor]: number}} state
 * @param {boolean} force
 * @return {Promise<{
 *   compressorMinRunTime: number,
 *   compressorContinuousOperation: number,
 *   lowTempLimit: number,
 *   offset: number,
 *   highTempLimit: number,
 *   compressorStartupDelay: number,
 *   compressorOperationCycleWhenSensorBreak: number,
 *   hysteresis: number,
 *   mode: MODE,
 *   compressorRestartDelay: number,
 *   compressorDutyRateWhenSensorBreak: number,
 *   compressorMinCycleTime: number,
 *   alarmDelayAfterContinuousOperation: number,
 * }>}
 */
const readPG2 = async (client, state = {}, force = false) => {
  if (force || !state.pg2) {
    await sleep(await readDelay(client, state))
    const tempDivisor = await readTempDivisor(client, state)
    const { data } = await client.readHoldingRegisters(0x96, 22)
    state.pg2 = {
      mode: READ_MODE_MAP[data[0]],
      hysteresis: data[1] / tempDivisor,
      offset: data[2] / tempDivisor,
      highTempLimit: readInt(data[3]) / tempDivisor,
      lowTempLimit: readInt(data[4]) / tempDivisor,
      compressorStartupDelay: data[14],
      compressorMinCycleTime: data[15],
      compressorRestartDelay: data[16],
      compressorMinRunTime: data[17],
      compressorContinuousOperation: data[18],
      alarmDelayAfterContinuousOperation: data[19],
      compressorOperationCycleWhenSensorBreak: data[20],
      compressorDutyRateWhenSensorBreak: data[21],
    }
  }
  return state.pg2
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {number} maxMsBetweenReports
 * @param {AUTONICS_TF3_STATE} state
 * @param {boolean} force
 * @return {Promise<Object>}
 */
async function read (client, { options: { maxMsBetweenReports = 1000 } = {} } = {}, state = {}, force = false) {
  const delay = await readDelay(client, state)

  let changed = false
  const result = {}

  await sleep(delay)
  const { data: inputsData } = await client.readInputRegisters(0x03E8, 13)
  const tempDivisor = result.tempDivisor = state.tempDivisor = TEMP_DIVISOR_MAP[inputsData[12]]
  result.currentTemp = readInt(inputsData[0]) / tempDivisor
  changed |= state.currentTemp !== result.currentTemp
  result.targetTemp = readInt(inputsData[1]) / tempDivisor
  changed |= state.targetTemp !== result.targetTemp
  result.temperatureUnit = READ_TEMPERATURE_UNIT_MAP[inputsData[3]]
  changed |= state.temperatureUnit !== result.temperatureUnit
  result.inputs = inputsData[7]
  changed |= state.inputs !== result.inputs
  result.s1Temp = readInt(inputsData[8]) / tempDivisor
  changed |= state.s1Temp !== result.s1Temp
  result.s2Temp = readInt(inputsData[9]) / tempDivisor
  changed |= state.s2Temp !== result.s2Temp
  result.s3Temp = readInt(inputsData[10]) / tempDivisor
  changed |= state.s3Temp !== result.s3Temp
  result.virtualTemp = readInt(inputsData[11]) / tempDivisor
  changed |= state.virtualTemp !== result.virtualTemp

  await sleep(delay)
  const { data: coilsData } = await client.readCoils(0x0000, 2)
  result.auxEnabled = coilsData[0]
  changed |= state.auxEnabled !== result.auxEnabled
  result.compEnabled = coilsData[1]
  changed |= state.compEnabled !== result.compEnabled

  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (state.lastReport > 0 && !changed && recentReport && !force) {
    return
  }

  state.lastReport = Date.now()
  Object.assign(state, result)

  result.device = await readDevice(client, state)
  result.pg1 = await readPG1(client, state)
  result.pg2 = await readPG2(client, state)
  result.mode = result.pg2.mode

  return result
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [auxEnabled]: boolean|null,
 *   [compEnabled]: boolean|null,
 *   [targetTemp]: number,
 *   [mode]: MODE,
 *   [pg1]: {
 *     [virtualTempRate]: number,
 *   },
 *   [pg2]: {
 *     [hysteresis]: number,
 *     [offset]: number,
 *     [highTempLimit]: number,
 *     [lowTempLimit]: number,
 *     [compressorStartupDelay]: number,
 *     [compressorMinCycleTime]: number,
 *     [compressorRestartDelay]: number,
 *     [compressorMinRunTime]: number,
 *     [compressorContinuousOperation]: number,
 *   }
 * }} values
 * @param {CONFIG} [config]
 * @param {AUTONICS_TF3_STATE} [state]
 * @returns {Promise<void>}
 */
async function write (client, values = {}, config = {}, state = {}) {
  const delay = await readDelay(client, state)
  if (values.auxEnabled != null) {
    await sleep(delay)
    await client.writeCoil(0x0000, values.auxEnabled)
    delete state.lastReport
  }
  if (values.compEnabled != null) {
    await sleep(delay)
    await client.writeCoil(0x0001, values.compEnabled)
    delete state.lastReport
  }
  if (values.targetTemp != null) {
    const tempDivisor = await readTempDivisor(client, state)
    await sleep(delay)
    await client.writeRegister(0x0000, writeInt(Math.round(values.targetTemp * tempDivisor)))
    delete state.lastReport
  }
  if (values.mode) {
    if (!(values.mode in WRITE_MODE_MAP)) {
      throw new Error(`Invalid mode value "${values.mode}". Valid ${Object.keys(WRITE_MODE_MAP).join(', ')}`)
    }
    await sleep(delay)
    await client.writeRegister(0x0096, WRITE_MODE_MAP[values.mode])
    delete state.lastReport
    delete state.pg2
  }
  if (values.pg1) {
    if (values.pg1.virtualTempRate) {
      await sleep(delay)
      await client.writeRegister(0x0067, Math.round(values.pg1.virtualTempRate))
      delete state.lastReport
      delete state.pg1
    }
  }
  if (values.pg2) {
    if (values.pg2.hysteresis) {
      const tempDivisor = await readTempDivisor(client, state)
      await sleep(delay)
      await client.writeRegister(0x0097, Math.round(values.pg2.hysteresis * tempDivisor))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.offset) {
      const tempDivisor = await readTempDivisor(client, state)
      await sleep(delay)
      await client.writeRegister(0x0098, Math.round(values.pg2.offset * tempDivisor))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.highTempLimit) {
      const tempDivisor = await readTempDivisor(client, state)
      await sleep(delay)
      await client.writeRegister(0x0099, writeInt(Math.round(values.pg2.highTempLimit * tempDivisor)))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.lowTempLimit) {
      const tempDivisor = await readTempDivisor(client, state)
      await sleep(delay)
      await client.writeRegister(0x009A, writeInt(Math.round(values.pg2.lowTempLimit * tempDivisor)))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.compressorStartupDelay) {
      await sleep(delay)
      await client.writeRegister(0x00A4, Math.round(values.pg2.compressorStartupDelay))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.compressorMinCycleTime) {
      await sleep(delay)
      await client.writeRegister(0x00A5, Math.round(values.pg2.compressorMinCycleTime))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.compressorRestartDelay) {
      await sleep(delay)
      await client.writeRegister(0x00A6, Math.round(values.pg2.compressorRestartDelay))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.compressorMinRunTime) {
      await sleep(delay)
      await client.writeRegister(0x00A7, Math.round(values.pg2.compressorMinRunTime))
      delete state.lastReport
      delete state.pg2
    }
    if (values.pg2.compressorContinuousOperation) {
      await sleep(delay)
      await client.writeRegister(0x00A8, Math.round(values.pg2.compressorContinuousOperation))
      delete state.lastReport
      delete state.pg2
    }
  }
}

/**
 * @param client
 * @param {{
 *   [address]: number,
 *   [responseDelay]: number,
 *   [temperatureUnit]: TEMPERATURE_UNIT,
 *   [inputType]: INPUT_TYPE,
 *   [input2Enabled]: boolean|null,
 *   [input3Type]: INPUT3_TYPE,
 *   [factoryReset]: true|null,
 * }} newConfig
 * @return {Promise<{}>}
 */
async function setup (client, newConfig) {
  const delay = await readDelay(client)
  const report = {}
  // coils
  if (newConfig.factoryReset) {
    await sleep(delay)
    await client.writeCoil(0x0002, true)
  }
  // PG1
  if (newConfig.inputType) {
    if (!(newConfig.inputType in WRITE_INPUT_TYPE_MAP)) {
      throw new Error(`Invalid input type value "${newConfig.inputType}". Valid ${Object.keys(WRITE_INPUT_TYPE_MAP).join(', ')}`)
    }
    report.inputType = await client.writeRegister(0x0064, WRITE_INPUT_TYPE_MAP[newConfig.inputType])
    await sleep(delay)
  }
  if (newConfig.input2Enabled != null) {
    report.input2Enabled = await client.writeRegister(0x0065, newConfig.input2Enabled ? 1 : 0)
    await sleep(20)
  }
  if (newConfig.input3Type != null) {
    if (!(newConfig.input3Type in WRITE_INPUT3_TYPE_MAP)) {
      throw new Error(`Invalid input 3 type value "${newConfig.input3Type}". Valid ${Object.keys(WRITE_INPUT3_TYPE_MAP).join(', ')}`)
    }
    report.input3Type = await client.writeRegister(0x0066, WRITE_INPUT3_TYPE_MAP[newConfig.input3Type])
    await sleep(delay)
  }
  if (newConfig.temperatureUnit) {
    if (!(newConfig.temperatureUnit in WRITE_TEMPERATURE_UNIT_MAP)) {
      throw new Error(`Invalid temperature unit value "${newConfig.temperatureUnit}". Valid ${Object.keys(WRITE_TEMPERATURE_UNIT_MAP).join(', ')}`)
    }
    report.temperatureUnit = await client.writeRegister(0x0068, WRITE_TEMPERATURE_UNIT_MAP[newConfig.temperatureUnit])
    await sleep(delay)
  }
  // PG5
  if (newConfig.address) {
    report.address = await client.writeRegister(0x0130, newConfig.address)
    client.setID(newConfig.address)
    await sleep(delay)
  }
  if (newConfig.responseDelay) {
    report.responseDelay = await client.writeRegister(0x0134, newConfig.responseDelay)
    await sleep(delay)
  }
  return report
}

module.exports = {
  read,
  write,
  setup
}
