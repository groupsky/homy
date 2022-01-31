const invertMap = (map) => Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]))

const READ_BAUD_RATE_MAP = {
  0: 2400,
  1: 4800,
  2: 9600,
  3: 19200,
  4: 38400,
  5: 57600,
  6: 115200,
}
const WRITE_BAUD_RATE_MAP = invertMap(READ_BAUD_RATE_MAP)

const READ_PARITY_MAP = {
  0: 'none',
  1: 'odd',
  2: 'even',
  3: 'always1',
  4: 'always0',
}
const WRITE_PARITY_MAP = invertMap(READ_PARITY_MAP)

const READ_MODBUS_MODE_MAP = {
  0: 'RTU',
  1: 'ASCII'
}
const WRITE_MODBUS_MODE_MAP = invertMap(READ_MODBUS_MODE_MAP)

const readBaudRate = (val) => READ_BAUD_RATE_MAP[val] || val * 10
const writeBaudRate = (val) => WRITE_BAUD_RATE_MAP[val] != null ? WRITE_BAUD_RATE_MAP[val] : val / 10

const readParity = (val) => READ_PARITY_MAP[val]
const writeParity = (val) => WRITE_PARITY_MAP[val]

const readStopBits = (val) => val & 0xFF
const writeStopBits = (val, prev) => (prev & 0xFF00) | (val && 0xFF)

const readDataBits = (val) => (val & 0xFF00) >> 8
const writeDataBits = (val, prev) => (prev & 0xFF) | (val << 8)

const readModbusMode = (val) => READ_MODBUS_MODE_MAP[val]
const writeModbusMode = (val) => WRITE_MODBUS_MODE_MAP[val]

const readLong = (lsb, msb) => msb << 16 | lsb
const writeLong = (value) => [value & 0xFFFF, value >> 16]

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<Object>}
 */
async function read (client, { options: { maxMsBetweenReports = 1000 } = {} } = {}, state = {}) {
  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (state.lastReport > 0 && recentReport) {
    return
  }

  state.lastReport = Date.now()

  let val = await client.readHoldingRegisters(0x0000, 2)
  const deviceVersionType = val.data[0]
  const switches = val.data[1]

  val = await client.readInputRegisters(0x02, 11)
  const baudRate = readBaudRate(val.data[0])
  const stopBits = readStopBits(val.data[1])
  const dataBits = readDataBits(val.data[1])
  const parity = readParity(val.data[2])
  const responseDelay = val.data[3]
  const modbusMode = readModbusMode(val.data[4])
  const watchdog = val.data[6]
  const defaultOutputState = val.data[10]

  val = await client.readInputRegisters(0x20, 6)
  const receivedPackets = readLong(val.data[0], val.data[1])
  const incorrectPackets = readLong(val.data[2], val.data[3])
  const sentPackets = readLong(val.data[4], val.data[5])

  val = await client.readInputRegisters(0x33, 1)
  const outputs = val.data[0]

  return {
    deviceVersionType,
    switches,
    baudRate,
    stopBits,
    dataBits,
    parity,
    responseDelay,
    modbusMode,
    watchdog,
    defaultOutputState,
    receivedPackets,
    incorrectPackets,
    sentPackets,
    outputs
  }
}

const COIL_MAP = {
  def0: 0x0C0,
  def1: 0x0C1,
  def2: 0x0C2,
  def3: 0x0C3,
  def4: 0x0C4,
  def5: 0x0C5,
  def6: 0x0C6,
  def7: 0x0C7,
  def8: 0x0C8,
  def9: 0x0C9,
  def10: 0x0CA,
  def11: 0x0CB,
  def12: 0x0CC,
  def13: 0x0CD,
  def14: 0x0CE,
  def15: 0x0CF,
  out0: 0x330,
  out1: 0x331,
  out2: 0x332,
  out3: 0x333,
  out4: 0x334,
  out5: 0x335,
  out6: 0x336,
  out7: 0x337,
  out8: 0x338,
  out9: 0x339,
  out10: 0x33A,
  out11: 0x33B,
  out12: 0x33C,
  out13: 0x33D,
  out14: 0x33E,
  out15: 0x33F,
}

const PACKETS_MAP = {
  receivedPackets: 0x20,
  incorrectPackets: 0x22,
  sentPackets: 0x24,
}

const REGISTERS_MAP = {
  watchdog: 0x08,
  defaultOutputState: 0x0C,
  outputs: 0x33
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [def0]: boolean,
 *   [def1]: boolean,
 *   [def2]: boolean,
 *   [def3]: boolean,
 *   [def4]: boolean,
 *   [def5]: boolean,
 *   [def6]: boolean,
 *   [def7]: boolean,
 *   [def8]: boolean,
 *   [def9]: boolean,
 *   [def10]: boolean,
 *   [def11]: boolean,
 *   [def12]: boolean,
 *   [def13]: boolean,
 *   [def14]: boolean,
 *   [def15]: boolean,
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
 *   [out13]: boolean,
 *   [out14]: boolean,
 *   [out15]: boolean,
 *   [watchdog]: number,
 *   [receivedPackets]: number,
 *   [incorrectPackets]: number,
 *   [sentPackets]: number,
 *   [outputs]: number,
 *   [defaultOutputState]: number,
 * }} values
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @returns {Promise<void>}
 */
async function write (client, values, config, state = {}) {
  for (const key in COIL_MAP) {
    if (key in values) {
      await client.writeCoil(COIL_MAP[key], !!values[key])
      // force new report
      state.lastReport = 0
    }
  }

  for (const key in PACKETS_MAP) {
    if (key in values) {
      await client.writeRegisters(PACKETS_MAP[key], writeLong(values[key]))
      // force new report
      state.lastReport = 0
    }
  }

  for (const key in REGISTERS_MAP) {
    if (key in values) {
      await client.writeRegister(REGISTERS_MAP[key], values[key])
      // force new report
      state.lastReport = 0
    }
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [baudRate]: (2400|4800|9600|19200|38400|57600|115200|Number),
 *   [parity]: ('none'|'odd'|'even'|'always1'|'always0'),
 *   [stopBits]: (1|2),
 *   [dataBits]: (7|8),
 *   [responseDelay]: Number,
 *   [modbusMode]: ('RTU'|'ASCII'),
 * }} newConfig
 * @return {Promise<void>}
 */
async function setup (client, newConfig) {
  const { data } = await client.readInputRegisters(0x02, 5)

  if (newConfig.baudRate != null) {
    data[0] = writeBaudRate(newConfig.baudRate)
  }
  if (newConfig.parity != null) {
    data[2] = writeParity(newConfig.parity)
  }
  if (newConfig.stopBits != null) {
    data[1] = writeStopBits(newConfig.stopBits, data[1])
  }
  if (newConfig.dataBits != null) {
    data[1] = writeDataBits(newConfig.dataBits, data[1])
  }
  if (newConfig.responseDelay != null) {
    data[3] = newConfig.responseDelay
  }
  if (newConfig.modbusMode != null) {
    data[4] = writeModbusMode(newConfig.modbusMode)
  }

  await client.writeRegisters(0x02, data)
}

module.exports = {
  read,
  write,
  setup
}
