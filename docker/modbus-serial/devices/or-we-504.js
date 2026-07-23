// ORNO OR-WE-504 - 1-phase energy meter with RS-485, 100A, 1 module, DIN TH-35mm
// Register map: https://files.orno.pl/support/Others/ORNO/ORWE504_5901752481282/OR-WE-504_rejestry.pdf
//
// Defaults: address=1 baudRate=9600 dataBits=8 parity=none stopBits=1
//
// Holding registers:
//   0x00 voltage         - uint16, 0.1V
//   0x01 current         - uint16, 0.1A
//   0x02 frequency       - uint16, 0.1Hz
//   0x03 active power    - uint16, 1W
//   0x04 reactive power  - uint16, 1var
//   0x05 apparent power  - uint16, 1VA
//   0x06 power factor    - uint16, factor*1000
//   0x07 active energy   - uint32 big endian (high word first), 1Wh
//   0x09 reactive energy - uint32 big endian (high word first), 1varh
//   0x0E baud rate       - uint16, see BAUD_RATE maps
//   0x0F modbus address  - uint16
//   0x10 password        - 2 registers, 4 BCD digits each (e.g. '11111111' -> [0x1111, 0x1111])
//
// NOTE: the energy word order is not pinned by the documentation - the only worked example
// (0x0ED3 = 3795Wh) has a zero high word, and the register table labels registers 7/8 both
// "UINT32 - Big Endian (ABCD)" and "Swapped long". Confirm against hardware before trusting
// energy totals above 65535Wh. The BCD password encoding is likewise inferred from an
// all-repdigit example ('11111111'); writing '12345678' on hardware would confirm it.
//
// The register documentation interleaves two different meters' register maps. Only the
// examples consistent with the OR-WE-504 table (holding registers 0x00-0x11, address at
// 0x0F) are implemented here; the other set - which reads registers 0x00-0x02 as a single
// energy counter and writes the address to 0x06 (power factor on this meter) - is ignored.
//
// Configuration registers are write protected. The meter is unlocked by function code 0x28
// at register 0xFE01, which stays valid for ~10 seconds - see `unlock`.

/**
 * @typedef {1200|2400|4800|9600} BAUD_RATE
 */

/**
 * @typedef {{
 *   [read]: {
 *     [instantaneous]: boolean, // also gates the garbage frame guard - keep enabled

 *     [energy]: boolean,
 *     [config]: boolean,
 *   },
 *   [options]: {
 *     [maxMsBetweenReports]: number, // 0 disables the periodic report of unchanged values
 *   }
 * }} CONFIG
 */

/**
 * @typedef {{
 *   [lastReport]: number,
 *   [v]: number,
 *   [c]: number,
 *   [freq]: number,
 *   [p]: number,
 *   [rp]: number,
 *   [ap]: number,
 *   [pow]: number,
 *   [tot_act]: number,
 *   [tot_react]: number,
 *   [baud_rate]: BAUD_RATE,
 *   [id]: number,
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
 * @param {number} val
 * @return {BAUD_RATE}
 */
const readBaudRate = (val) => READ_BAUD_RATE_MAP[val]
/**
 * @param {BAUD_RATE} val
 * @return {number}
 */
const writeBaudRate = (val) => {
  const code = WRITE_BAUD_RATE_MAP[val]
  if (code == null) {
    throw new Error(`Unsupported baud rate ${val}, expected one of ${Object.keys(WRITE_BAUD_RATE_MAP)}`)
  }
  return code
}

/**
 * @param {number} msb
 * @param {number} lsb
 * @return {number}
 */
const readLong = (msb, lsb) => msb * 0x10000 + lsb

/**
 * Encode an 8 digit password as the 2 BCD registers expected by the meter,
 * e.g. '12345678' -> [0x1234, 0x5678]
 * @param {string} password
 * @return {Array<number>}
 */
const writePassword = (password) => {
  const digits = String(password)
  if (!/^\d{8}$/.test(digits)) {
    throw new Error('Password must be exactly 8 digits')
  }
  return digits.match(/.{4}/g).map((part) => parseInt(part, 16))
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<STATE|undefined>}
 */
async function read (
  client, {
    read: {
      instantaneous = true,
      energy = true,
      config = false,
    } = {},
    options: {
      maxMsBetweenReports = 1000,
    } = {}
  } = {},
  state = {}
) {
  const result = {}
  let changed = false

  if (instantaneous) {
    const { data } = await client.readHoldingRegisters(0x00, 7)
    // voltage in V
    result.v = data[0] / 10
    changed |= result.v !== state.v
    // current in A
    result.c = data[1] / 10
    changed |= result.c !== state.c
    // frequency in Hz
    result.freq = data[2] / 10
    changed |= result.freq !== state.freq
    // active power in W
    result.p = data[3]
    changed |= result.p !== state.p
    // reactive power in VAr
    result.rp = data[4]
    changed |= result.rp !== state.rp
    // apparent power in VA
    result.ap = data[5]
    changed |= result.ap !== state.ap
    // power factor
    result.pow = data[6] / 1000
    changed |= result.pow !== state.pow

    // The meter is line powered, so it cannot answer while reporting no voltage and no grid
    // frequency. A frame that does is a meter-side glitch (corrupted frames are already
    // rejected by the CRC check, and other slaves' replies by the unit id filter). Dropping
    // the whole poll keeps a spurious zero out of the monotonic energy counters, where it
    // would show up downstream as a full-counter drop and an equal phantom spike on recovery.
    // Logged because otherwise a misfiring guard is indistinguishable from "value unchanged".
    if (result.v === 0 && result.freq === 0) {
      console.warn('Ignoring or-we-504 frame reporting no voltage and no grid frequency')
      return
    }
  }

  if (energy) {
    const { data } = await client.readHoldingRegisters(0x07, 4)
    // total active energy in kWh (device reports Wh)
    result.tot_act = readLong(data[0], data[1]) / 1000
    changed |= result.tot_act !== state.tot_act
    // total reactive energy in kVArh (device reports VArh)
    result.tot_react = readLong(data[2], data[3]) / 1000
    changed |= result.tot_react !== state.tot_react
  }

  if (config) {
    const { data } = await client.readHoldingRegisters(0x0E, 2)
    result.baud_rate = readBaudRate(data[0])
    changed |= result.baud_rate !== state.baud_rate
    result.id = data[1]
    changed |= result.id !== state.id
  }

  const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
  if (state.lastReport > 0 && !changed && recentReport) {
    return
  }

  state.lastReport = Date.now()
  if (instantaneous) {
    state.v = result.v
    state.c = result.c
    state.freq = result.freq
    state.p = result.p
    state.rp = result.rp
    state.ap = result.ap
    state.pow = result.pow
  }
  if (energy) {
    state.tot_act = result.tot_act
    state.tot_react = result.tot_react
  }
  if (config) {
    state.baud_rate = result.baud_rate
    state.id = result.id
  }

  return result
}

// the unlock is only valid for ~10 seconds, and the request below always burns a full
// client timeout waiting for a reply that never arrives - cap that so the window is not
// spent before the first write lands
const MAX_UNLOCK_TIMEOUT_MS = 500

/**
 * Unlock the write protection on the configuration registers, valid for ~10 seconds.
 * Emitted as function code 0x28 at register 0xFE01. `RTUBufferedPort` has no expected reply
 * length for that function code, so the reply is dropped at the port layer and never reaches
 * the protocol layer - the request does go out, but the transaction always times out. The
 * timeout is therefore the expected outcome and is ignored here.
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {string} [password] current meter password, factory default '00000000'
 * @return {Promise<void>}
 */
async function unlock (client, password = '00000000') {
  const [hi, lo] = writePassword(password)
  const timeout = client.getTimeout()
  client.setTimeout(Math.min(timeout, MAX_UNLOCK_TIMEOUT_MS))
  try {
    await client.customFunction(0x28, [
      // register 0xFE01, 2 registers, 4 data bytes
      0xFE, 0x01, 0x00, 0x02, 0x04,
      hi >> 8, hi & 0xFF, lo >> 8, lo & 0xFF,
    ])
  } catch (e) {
    if (e.errno !== 'ETIMEDOUT') throw e
  } finally {
    client.setTimeout(timeout)
  }
}

/**
 * Setup communication parameters. The write protection is lifted first, which requires the
 * meter's current password. Writes are ordered so that they are safe whether the meter
 * applies each change immediately or only on restart - see the note on `baudRate` below.
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [address]: number,
 *   [baudRate]: BAUD_RATE,
 *   [password]: string,
 *   [newPassword]: string,
 * }} newConfig
 * @return {Promise<void>}
 */
async function setup (client, newConfig) {
  if (newConfig.baudRate == null && newConfig.newPassword == null && newConfig.address == null) {
    return
  }

  // validate before unlocking, so a bad argument does not leave the meter unprotected
  const baudRate = newConfig.baudRate != null ? writeBaudRate(newConfig.baudRate) : null
  const newPassword = newConfig.newPassword != null ? writePassword(newConfig.newPassword) : null

  await unlock(client, newConfig.password)

  if (newPassword != null) {
    await client.writeRegisters(0x10, newPassword)
  }
  if (newConfig.address != null) {
    const previousAddress = client.getID()
    try {
      await client.writeRegisters(0x0F, [newConfig.address])
    } catch (e) {
      // The meter answers the address write from its new unit id. RTUBufferedPort drops
      // replies whose unit id is not the one addressed, so the transaction simply times out;
      // over an unbuffered/TCP transport the protocol layer reports the mismatch instead.
      // Either way the write itself may well have succeeded - the read back below decides.
      const applied = e.errno === 'ETIMEDOUT' ||
        new RegExp(`expected address \\d+ got ${newConfig.address}$`).test(e.message)
      if (!applied) throw e
    }
    // The meter answers its own address write from the new address (the documented reply
    // `02 10 00 0F 00 01 31 F9` carries a CRC only valid for a frame addressed 0x02), so it
    // is reachable there straight away and the read back is meaningful.
    client.setID(newConfig.address)
    let reported
    try {
      const { data } = await client.readHoldingRegisters(0x0F, 1)
      reported = data[0]
    } catch (e) {
      // leave the client where the meter actually is, so the caller can retry
      client.setID(previousAddress)
      throw new Error(`Address change could not be verified, meter is unreachable at ${newConfig.address}`, { cause: e })
    }
    if (reported !== newConfig.address) {
      client.setID(previousAddress)
      throw new Error(`Address change failed, meter reports address ${reported}`)
    }
  }
  // The baud rate is written last and is deliberately not verified. Its acknowledgement is
  // sent at the old rate, but whether the meter then switches immediately or only on restart
  // is not documented - so a read back would fail spuriously under one of the two, and the
  // caller has to reopen the port at the new rate either way. Writing it last is safe under
  // both: nothing follows that could be stranded at the wrong rate.
  if (baudRate != null) {
    await client.writeRegisters(0x0E, [baudRate])
  }
}

module.exports = {
  read,
  setup,
}
