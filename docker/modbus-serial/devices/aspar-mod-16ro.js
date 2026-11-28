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
const writeStopBits = (val, prev) => (prev & 0xFF00) | (val & 0xFF)

const readDataBits = (val) => (val & 0xFF00) >> 8
const writeDataBits = (val, prev) => (prev & 0xFF) | (val << 8)

const readModbusMode = (val) => READ_MODBUS_MODE_MAP[val]
const writeModbusMode = (val) => WRITE_MODBUS_MODE_MAP[val]

const readLong = (lsb, msb) => msb << 16 | lsb
const writeLong = (value) => [value & 0xFFFF, value >> 16]

// The full report: settings, packet counters and the 16 outputs.
async function readReport (client) {
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

/**
 * A board with `options.restore` in its config gets the restore after a
 * restart (see readWithRestore). A board without it is read as before: a full
 * report every maxMsBetweenReports, nothing in between.
 *
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<Object>}
 */
async function read (client, config = {}, state = {}, force = false) {
  const { options: { maxMsBetweenReports = 1000 } = {} } = config
  if (config.options?.restore) {
    return readWithRestore(client, config, state, maxMsBetweenReports)
  }

  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (state.lastReport > 0 && recentReport && !force) {
    return
  }

  state.lastReport = Date.now()

  return readReport(client)
}

// The board's 12 V supply is not on the UPS, so a mains dip restarts it and
// its outputs come back in their power-up state (#2008). The board keeps no
// record of a restart; its received-packets counter starts again near 0, so a
// counter lower than its last value is a restart.
const CHECK_INTERVAL_MS = 1000
const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 60000

const OUTPUT_NAMES = Array.from({ length: 16 }, (_, i) => `out${i}`)

// options.restore: {restoreWithinMs, defaultState, outputs: {outN: {...}}}.
// The board-wide values apply to each listed output; an output's own object
// overrides them. An output that is not listed is never written.
function parseRestoreConfig (name, restore) {
  const outputs = []
  for (const [key, own] of Object.entries(restore.outputs || {})) {
    const bit = OUTPUT_NAMES.indexOf(key)
    if (bit < 0) throw new Error(`${name}: restore.outputs has an unknown output ${key} (out0 to out15)`)
    const { restoreWithinMs, defaultState } = { restoreWithinMs: restore.restoreWithinMs, defaultState: restore.defaultState, ...own }
    if (restoreWithinMs != null && !(Number.isFinite(restoreWithinMs) && restoreWithinMs >= 0)) {
      throw new Error(`${name}: ${key} restoreWithinMs must be a number of ms, got ${restoreWithinMs}`)
    }
    if (defaultState != null && typeof defaultState !== 'boolean') {
      throw new Error(`${name}: ${key} defaultState must be true or false, got ${defaultState}`)
    }
    outputs.push({ key, bit, restoreWithinMs, defaultState })
  }
  return outputs
}

const bitOf = (word, bit) => ((word >> bit) & 1) === 1

// The received-packets counter, unsigned (readLong is signed from 2^31).
async function readCounter (client) {
  const { data } = await client.readInputRegisters(0x20, 2)
  return ((data[1] << 16) | data[0]) >>> 0
}

/**
 * Reads a board that has restore config. In the poll loop it is called on
 * every pass, while index.js holds the bus:
 *
 * - about every CHECK_INTERVAL_MS it reads only the received-packets counter
 *   (2 registers) and returns nothing, unless the counter fell (a restart);
 * - the full report still comes every maxMsBetweenReports, and after a write;
 * - after a restart it writes back the configured outputs (restoreOutputs)
 *   and returns a full report at once;
 * - a board that does not answer is tried again after 1 s, then 2, 4 ... up
 *   to 60 s. These errors are logged here and not thrown, so they do not
 *   count towards index.js's port reopen; only a closed port is thrown.
 */
async function readWithRestore (client, config, state, maxMsBetweenReports) {
  const name = config.name || 'aspar-mod-16ro'
  if (!state.restoreOutputs) state.restoreOutputs = parseRestoreConfig(name, config.options.restore)

  const now = Date.now()
  if (state.nextTryAt != null && now < state.nextTryAt) return
  const reportDue = state.reportPending || !(state.lastReport > 0) || now - state.lastReport >= maxMsBetweenReports
  const checkDue = state.lastCheck == null || now - state.lastCheck >= CHECK_INTERVAL_MS
  if (!reportDue && !checkDue && !state.pendingRestore) return

  try {
    state.lastCheck = now
    const counter = await readCounter(client)
    const contactAt = Date.now()
    if (state.failures > 0 && state.lastContact != null) {
      console.log(`${name} answers again after ${contactAt - state.lastContact} ms`)
    }
    if (state.counter != null && counter < state.counter) {
      // Gone from the last good contact before to this first one after.
      state.pendingRestore = { from: state.counter, to: counter, goneMs: contactAt - state.lastContact }
    }
    state.counter = counter
    state.lastContact = contactAt
    state.failures = 0
    state.nextTryAt = null

    if (state.pendingRestore) {
      await restoreOutputs(client, name, state)
      state.pendingRestore = null
      // the report after a restore is sent even if its first try fails
      state.reportPending = true
    } else if (!reportDue) {
      return
    }

    let report = await readReport(client)
    if (!state.defaultsChecked) {
      report = await syncDefaults(client, name, state, report)
    }
    if (report.receivedPackets >>> 0 < counter) {
      // The board restarted after the counter read: this report shows its
      // power-up outputs. Keep what was known before, restore on the next pass.
      const contactAt = Date.now()
      state.pendingRestore = { from: counter, to: report.receivedPackets >>> 0, goneMs: contactAt - state.lastContact }
      state.counter = report.receivedPackets >>> 0
      state.lastContact = contactAt
      state.reportPending = true
      return
    }
    state.lastReport = Date.now()
    state.reportPending = false
    state.lastContact = state.lastReport
    state.counter = report.receivedPackets >>> 0
    state.reported = report.outputs
    state.commands = {}
    return report
  } catch (e) {
    if (e.name === 'PortNotOpenError') throw e
    state.failures = (state.failures || 0) + 1
    const delay = Math.min(RETRY_MIN_MS * 2 ** (state.failures - 1), RETRY_MAX_MS)
    state.nextTryAt = Date.now() + delay
    console.error(`${name} does not answer (${e.message}), try ${state.failures}, next try in ${delay} ms`)
  }
}

// Each configured output gets its wanted value back if the board was gone no
// longer than its restoreWithinMs, else its defaultState; with neither it is
// left as the board came up. Only outputs that differ are written.
async function restoreOutputs (client, name, state) {
  const { from, to, goneMs } = state.pendingRestore
  const { data: [outputs] } = await client.readInputRegisters(0x33, 1)
  // Each request is counted by the board, so a second restart during the
  // restore or the report still shows as a lower counter.
  state.counter += 1
  const written = []
  const commands = state.commands || {}
  for (const { key, bit, restoreWithinMs, defaultState } of state.restoreOutputs) {
    let value
    let why
    if (restoreWithinMs != null && goneMs <= restoreWithinMs) {
      if (key in commands) {
        value = commands[key]
        why = 'last written value'
      } else if (state.reported != null) {
        value = bitOf(state.reported, bit)
        why = 'last report'
      }
    }
    if (value == null && defaultState != null) {
      value = defaultState
      why = restoreWithinMs == null ? 'defaultState'
        : goneMs > restoreWithinMs ? `defaultState, gone longer than ${restoreWithinMs} ms`
          : 'defaultState, no wanted value known'
    }
    if (value == null || bitOf(outputs, bit) === value) continue
    await client.writeCoil(COIL_MAP[key], value)
    state.counter += 1
    written.push(`${key}=${value} (${why})`)
  }
  console.log(`${name} restarted (received packets ${from} -> ${to}), gone ${goneMs} ms: ` +
    (written.length ? `wrote ${written.join(', ')}` : 'nothing to write, the outputs already match'))
}

// The board's own power-up state (def* coils, read back in register 0x0C) is
// set from defaultState, so the board also starts right while the reader is
// down. It is checked once, at the first full report: the board keeps these
// settings in a memory that wears, so only coils that differ are written.
// A failure here does not stop the report; the check is tried again at the
// next full report.
async function syncDefaults (client, name, state, report) {
  let changed = false
  try {
    for (const { key, bit, defaultState } of state.restoreOutputs) {
      if (defaultState == null || bitOf(report.defaultOutputState, bit) === defaultState) continue
      const def = `def${bit}`
      await client.writeCoil(COIL_MAP[def], defaultState)
      console.log(`${name} power-up state: ${def} (${key}) ${!defaultState} -> ${defaultState}`)
      changed = true
    }
    state.defaultsChecked = true
    if (!changed) return report
    const { data: [defaultOutputState] } = await client.readInputRegisters(0x0C, 1)
    return { ...report, defaultOutputState }
  } catch (e) {
    if (e.name === 'PortNotOpenError') throw e
    state.defaultsChecked = false
    console.error(`${name} could not set the power-up state (${e.message}), trying again at the next full report`)
    return report
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
  // Only a value that was written with success is kept for a restore: a
  // command whose write failed is never written back later.
  const restore = !!config?.options?.restore
  const commands = restore ? (state.commands = state.commands || {}) : null

  for (const key in COIL_MAP) {
    if (key in values) {
      await client.writeCoil(COIL_MAP[key], !!values[key])
      if (restore && OUTPUT_NAMES.includes(key)) commands[key] = !!values[key]
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
      if (restore && key === 'outputs') {
        for (const [bit, name] of OUTPUT_NAMES.entries()) commands[name] = bitOf(values.outputs, bit)
      }
      // force new report
      state.lastReport = 0
    }
  }

  // The board answered, so a back-off after earlier errors ends here and the
  // next poll reads it (and finds a restart, if there was one).
  if (config?.options?.restore) state.nextTryAt = null
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
  writeStopBits,
  read,
  write,
  setup
}
