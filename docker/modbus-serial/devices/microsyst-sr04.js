// https://www.microsyst.net/en/product/sr-04-2/

const INTER_COMM_DELAY = 25

/**
 * @typedef {9600|19200} BAUD_RATE
 */
/**
 * @typedef {'none'|'even'} PARITY
 */
/**
 * @typedef {1|2} STOP_BITS
 */

/**
 * @typedef {{
 *   address: number,
 *   stopBits: STOP_BITS,
 *   parity: PARITY,
 *   baudRate: BAUD_RATE,
 *   broadcast: boolean,
 * }} MICROSYST_SR04_COMMUNICATION_STATE
 */

/**
 * @typedef {{
 *   fast: boolean,
 *   p1: boolean,
 *   p2: boolean,
 *   p3: boolean,
 *   p4: boolean,
 *   p5: boolean,
 *   p6: boolean,
 *   p7: boolean,
 *   p8: boolean,
 * }} MICROSYST_SR04_OUTPUT_STATE
 */

/**
 * @typedef {{
 *   ss: number,
 *   mm: number,
 *   hh: number,
 *   dayWeek: number,
 *   day: number,
 *   month: number,
 *   year: number,
 * }} MICROSYST_SR04_TIMER_STATE
 */

/**
 * @typedef {{
 *   calibrationNtc5341k: number,
 *   calibrationNtc2588k: number,
 *   calibrationPt1000k: number,
 *   calibrationPt1385k: number,
 *   filter: number,
 *   adcJump: number,
 *   jumpTime: number,
 *   on1: number,
 *   off1: number,
 *   on2: number,
 *   off2: number,
 *   on3: number,
 *   off3: number,
 *   spT1: number,
 *   maxT2: number,
 *   maxT3T4: number,
 *   minT3T4: number,
 *   freez: number,
 *   delta: number,
 *   toler: number,
 *   h: number,
 *   h2: number,
 *   h3: number,
 *   spT5: number,
 *   spT7: number,
 *   minT8: number,
 *   maxT8: number,
 *   freezT8: number,
 *   sheme: number,
 *   kickOff: number,
 *   kickOn: number,
 *   kickPause: number,
 *   kickTime: number,
 *   time05C: number,
 *   heatSp: number,
 *   trialTime: number,
 *   dPoint: number,
 * }} MICROSYST_SR04_CONFIGURATION_STATE
 */

/**
 * @typedef {{
 *   boilerLowE1: boolean,
 *   solar2E4: boolean,
 *   accumulE5: boolean,
 *   heatInstallationE6: boolean,
 *   poolE7: boolean,
 *   chimneyE8: boolean,
 *   typeSens: boolean,
 *   trial: boolean,
 *   prior: boolean,
 *   sumWin: boolean,
 *   sensorError: number,
 *   adc2: number,
 *   adc3: number,
 *   t1: number,
 *   t2: number,
 *   t3: number,
 *   t4: number,
 *   t5: number,
 *   t6: number,
 *   t7: number,
 *   t8: number,
 * }} MICROSYST_SR04_PRIMARY_STATE
 */

/**
 * @typedef {MICROSYST_SR04_PRIMARY_STATE & {
 *   communication: MICROSYST_SR04_COMMUNICATION_STATE,
 *   outputs: MICROSYST_SR04_OUTPUT_STATE,
 *   configuration: MICROSYST_SR04_CONFIGURATION_STATE,
 *   timer: MICROSYST_SR04_TIMER_STATE
 * }} MICROSYST_SR04_STATE
 */

/**
 * @param {number} val
 * @return {number}
 */
const readByte = (val) => val & 0xFF

/**
 * @param {number} val
 * @return {number[]}
 */
const readBytes = (val) => {
  const bytes = []
  while (val > 0 || bytes.length < 4) {
    bytes.push(readByte(val))
    val = val >> 8
  }
  return bytes
}

/**
 * @param {number} val
 * @return {number}
 */
const readHex = (val) => Number.parseInt(val.toString(16), 10)

/**
 * @param {number} val
 * @return {number}
 */
const readInt = (val) => val >> 15 ? val - 0x10000 : val

/**
 * @param {number} val
 * @return {number}
 */
const readTemperature = (val) => val === 2070 ? null : readInt(val) / 10

/**
 * @param {number} timeout
 * @return {Promise<void>}
 */
const sleep = (timeout) => new Promise(resolve => setTimeout(resolve, timeout))

/**
 *
 * @param {import('modbus-serial').ModbusRTU} client
 * @return {Promise<MICROSYST_SR04_PRIMARY_STATE>}
 */
const readPrimaryState = async (client) => {
  await sleep(INTER_COMM_DELAY)
  const {
    data: [
      boilerLowE1,
      solar2E4,
      accumulE5,
      heatInstallationE6,
      poolE7,
      chimneyE8,
      typeSens,
      trial,
      ...rest
    ]
  } = await client.readCoils(296, 64)
  const [prior, sumWin] = rest.slice(-8)
  await sleep(INTER_COMM_DELAY)
  const {
    data: [
      sensorError,
      adc2,
      adc3,
      t1,
      t2,
      t3,
      t4,
      t5,
      t6,
      t7,
      t8,
    ]
  } = await client.readHoldingRegisters(557, 11)
  return {
    boilerLowE1,
    solar2E4,
    accumulE5,
    heatInstallationE6,
    poolE7,
    chimneyE8,
    typeSens,
    trial,
    prior,
    sumWin,
    sensorError: readByte(sensorError),
    adc2: readInt(adc2),
    adc3: readInt(adc3),
    t1: readTemperature(t1),
    t2: readTemperature(t2),
    t3: readTemperature(t3),
    t4: readTemperature(t4),
    t5: readTemperature(t5),
    t6: readTemperature(t6),
    t7: readTemperature(t7),
    t8: readTemperature(t8),
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {Partial<MICROSYST_SR04_STATE>} state
 * @param {boolean} force
 * @return {Promise<MICROSYST_SR04_COMMUNICATION_STATE>}
 */
const readCommunicationState = async (client, state = {}, force = false) => {
  if (force || !state.communication) {
    await sleep(INTER_COMM_DELAY)
    const {
      data: [
        stopBits,
        parity,
        baudRate,
        broadcast,
      ]
    } = await client.readCoils(1000, 4)
    await sleep(INTER_COMM_DELAY)
    const { data: [address] } = await client.readHoldingRegisters(127, 1)
    state.communication = {
      address,
      stopBits: stopBits ? 1 : 2,
      parity: parity ? 'none' : 'even',
      baudRate: baudRate ? 19200 : 9600,
      broadcast
    }
  }
  return state.communication
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @return {Promise<MICROSYST_SR04_OUTPUT_STATE>}
 */
const readOutputsState = async (client) => {
  await sleep(INTER_COMM_DELAY)
  const start = 2864
  const { data } = await client.readCoils(start, 40)
  const fast = data[2865 - start]
  const [p1, p2, p3, p4, p5, p6, p7, p8] = data.slice(2896 - start)
  return {
    fast,
    p1, p2, p3, p4, p5, p6, p7, p8
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {Partial<MICROSYST_SR04_STATE>} state
 * @param {boolean} force
 * @return {Promise<MICROSYST_SR04_CONFIGURATION_STATE>}
 */
const readConfiguration = async (client, state = {}, force = false) => {
  if (force || !state.configuration) {
    await sleep(INTER_COMM_DELAY)
    const {
      data: [
        calibrationNtc5341k, ,
        calibrationNtc2588k, ,
        calibrationPt1000k, ,
        calibrationPt1385k, ,
        , ,
        , ,
        filter,
        adcJump,
        jumpTime,
        on1,
        off1,
        on2,
        off2,
        on3,
        off3,
        spT1,
        maxT2,
        maxT3T4,
        minT3T4,
        freez,
        delta,
        toler,
        h,
        h2,
        h3,
        spT5,
        spT7,
        minT8,
        maxT8,
      ]
    } = await client.readHoldingRegisters(0, 35)
    await sleep(INTER_COMM_DELAY)
    const {
      data: [
        freezT8,
        sheme,
        ,
        kickOff,
        kickOn,
        kickPause,
        kickTime,
        time05C,
        heatSp,
        ,
        trialTime,
        , ,
        dPoint,
      ]
    } = await client.readHoldingRegisters(35, 14)
    state.configuration = {
      calibrationNtc5341k: readInt(calibrationNtc5341k),
      calibrationNtc2588k: readInt(calibrationNtc2588k),
      calibrationPt1000k: readInt(calibrationPt1000k),
      calibrationPt1385k: readInt(calibrationPt1385k),
      filter: readInt(filter),
      adcJump: readInt(adcJump),
      jumpTime: readInt(jumpTime),
      on1: readInt(on1),
      off1: readInt(off1),
      on2: readInt(on2),
      off2: readInt(off2),
      on3: readInt(on3),
      off3: readInt(off3),
      spT1: readInt(spT1),
      maxT2: readInt(maxT2),
      maxT3T4: readInt(maxT3T4),
      minT3T4: readInt(minT3T4),
      freez: readInt(freez),
      delta: readInt(delta),
      toler: readInt(toler),
      h: readTemperature(h),
      h2: readTemperature(h2),
      h3: readTemperature(h3),
      spT5: readInt(spT5),
      spT7: readInt(spT7),
      minT8: readInt(minT8),
      maxT8: readInt(maxT8),
      freezT8: readInt(freezT8),
      sheme: readInt(sheme),
      kickOff: readInt(kickOff),
      kickOn: readInt(kickOn),
      kickPause: readInt(kickPause),
      kickTime: readInt(kickTime),
      time05C: readInt(time05C),
      heatSp: readInt(heatSp),
      trialTime: readInt(trialTime),
      dPoint: readInt(dPoint),
    }
  }
  return state.configuration
}

const readTimer = async (client) => {
  await sleep(INTER_COMM_DELAY)
  const { data } = await client.readHoldingRegisters(1024, 4)
  const [mm, ss] = readBytes(data[0])
  const [dayWeek, hh] = readBytes(data[1])
  const [month, day] = readBytes(data[2])
  const [, year] = readBytes(data[3])
  return {
    ss: readHex(ss),
    mm: readHex(mm),
    hh: readHex(hh),
    dayWeek: dayWeek - 1,
    day: readHex(day),
    month: readHex(month),
    year: readHex(year)
  }
}

// The allowed range of each clock field, as the reading shows it: dayWeek 0 is
// Sunday, year is the last two digits.
const TIMER_RANGES = {
  ss: [0, 59],
  mm: [0, 59],
  hh: [0, 23],
  dayWeek: [0, 6],
  day: [1, 31],
  month: [1, 12],
  year: [0, 99],
}

/**
 * @param {number} val 0..99
 * @return {number} the same number in BCD, e.g. 59 -> 0x59
 */
const writeHex = (val) => Math.floor(val / 10) * 16 + val % 10

/**
 * @param {number} high
 * @param {number} low
 * @return {number}
 */
const writeBytes = (high, low) => (high << 8) | low

/**
 * Checks that the message is a full clock and nothing else, so a write can
 * never reach a setting. Keys that start with `_` are the metadata the
 * automations add to every message (`_bot`, `_tz`) and are ignored.
 * @param {unknown} message
 * @return {MICROSYST_SR04_TIMER_STATE}
 */
const validateTimer = (message) => {
  if (message == null || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('The message must be an object')
  }
  const keys = Object.keys(message).filter((key) => !key.startsWith('_'))
  if (keys.length !== 1 || keys[0] !== 'timer') {
    throw new Error(`Only the timer can be written, got: ${keys.join(', ') || 'nothing'}`)
  }
  const { timer } = message
  if (timer == null || typeof timer !== 'object' || Array.isArray(timer)) {
    throw new Error('The timer must be an object')
  }
  const unknown = Object.keys(timer).filter((key) => !Object.hasOwn(TIMER_RANGES, key))
  if (unknown.length) {
    throw new Error(`Unknown timer fields: ${unknown.join(', ')}`)
  }
  for (const [field, [min, max]] of Object.entries(TIMER_RANGES)) {
    const val = timer[field]
    if (!Number.isInteger(val) || val < min || val > max) {
      throw new Error(`The timer ${field} must be a whole number from ${min} to ${max}, got: ${val}`)
    }
  }
  return timer
}

/**
 * Sets the clock (holding registers 1024..1027, manual page 16). Nothing else
 * can be written. The device supports only FC06 (write single register), so
 * the clock takes four writes. Seconds and minutes go first: the caller sends
 * a time with seconds away from 59, so the clock cannot roll over to the next
 * minute or hour between the writes.
 *
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{timer: MICROSYST_SR04_TIMER_STATE}} message
 * @param {Object} config
 * @param {Partial<MICROSYST_SR04_STATE>} state
 * @return {Promise<void>}
 */
async function write(client, message, config, state = {}) {
  const { ss, mm, hh, dayWeek, day, month, year } = validateTimer(message)

  // The low byte of 1027 is not documented, so it is written back as it is
  await sleep(INTER_COMM_DELAY)
  const { data: [yearRegister] } = await client.readHoldingRegisters(1027, 1)

  await sleep(INTER_COMM_DELAY)
  await client.writeRegister(1024, writeBytes(writeHex(ss), writeHex(mm)))
  await sleep(INTER_COMM_DELAY)
  // The device counts week days from 1 (Sunday), the reading from 0
  await client.writeRegister(1025, writeBytes(writeHex(hh), dayWeek + 1))
  await sleep(INTER_COMM_DELAY)
  await client.writeRegister(1026, writeBytes(writeHex(day), writeHex(month)))
  await sleep(INTER_COMM_DELAY)
  await client.writeRegister(1027, writeBytes(writeHex(year), readByte(yearRegister)))

  // The next poll reads the settings again, so the readings show them before
  // and after the write
  state.configuration = undefined
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {number} maxMsBetweenReports
 * @param {Partial<MICROSYST_SR04_STATE>} state
 * @param {boolean} force
 * @return {Promise<Object>}
 */
async function read(client, { options: { maxMsBetweenReports = 1000 } = {} } = {}, state = {}, force = false) {
  const result = await readPrimaryState(client)

  result.configuration = await readConfiguration(client, state)
  result.communication = await readCommunicationState(client, state)
  result.outputs = await readOutputsState(client, state)
  result.timer = await readTimer(client, state)

  return result
}

module.exports = {
  read,
  write,
}
