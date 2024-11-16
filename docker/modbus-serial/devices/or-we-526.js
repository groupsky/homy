// https://www.orno.pl/en/energy-meters-with-mid/346--5908254827853.html

/**
 * @typedef {9600|19200|38400|115200} BAUD_RATE
 */

/**
 * @typedef {'none'|'even'|'odd'} PARITY
 */

/**
 * @typedef {1|2} STOP_BITS
 */

/**
 * @typedef {'forward'|'reverse'|'forward+reverse'|'forward-reverse'} COMBINED_CODE
 */

/**
 * @typedef {'interval'|'slip'} DEMAND_MODE
 */

/**
 * @typedef {{
 *   [read]: {
 *     [instantaneous]: boolean,
 *     [energy]: boolean,
 *     [quadrants]: boolean,
 *     [system]: boolean,
 *     [time]: boolean,
 *     [config]: boolean,
 *     [tariffs]: boolean,
 *   },
 *   [options]: {
 *     [maxMsBetweenReports]: number,
 *   }
 * }} CONFIG
 */

/**
 * @typedef {{
 *   [lastReport]: number,
 *   [v]: number,
 *   [c]: number,
 *   [ap]: number,
 *   [app]: number,
 *   [rp]: number,
 *   [freq]: number,
 *   [pow]: number,
 *   [tot_act]: number,
 *   [tot_act_t1]: number,
 *   [tot_act_t2]: number,
 *   [tot_act_t3]: number,
 *   [tot_act_t4]: number,
 *   [tot_act_rev]: number,
 *   [tot_act_rev_t1]: number,
 *   [tot_act_rev_t2]: number,
 *   [tot_act_rev_t3]: number,
 *   [tot_act_rev_t4]: number,
 *   [act]: number,
 *   [act_t1]: number,
 *   [act_t2]: number,
 *   [act_t3]: number,
 *   [act_t4]: number,
 *   [tot_react]: number,
 *   [tot_react_t1]: number,
 *   [tot_react_t2]: number,
 *   [tot_react_t3]: number,
 *   [tot_react_t4]: number,
 *   [tot_react_rev]: number,
 *   [tot_react_rev_t1]: number,
 *   [tot_react_rev_t2]: number,
 *   [tot_react_rev_t3]: number,
 *   [tot_react_rev_t4]: number,
 *   [react]: number,
 *   [react_t1]: number,
 *   [react_t2]: number,
 *   [react_t3]: number,
 *   [react_t4]: number,
 *   [react_1]: number,
 *   [react_1_t1]: number,
 *   [react_1_t2]: number,
 *   [react_1_t3]: number,
 *   [react_1_t4]: number,
 *   [react_2]: number,
 *   [react_2_t1]: number,
 *   [react_2_t2]: number,
 *   [react_2_t3]: number,
 *   [react_2_t4]: number,
 *   [react_3]: number,
 *   [react_3_t1]: number,
 *   [react_3_t2]: number,
 *   [react_3_t3]: number,
 *   [react_3_t4]: number,
 *   [react_4]: number,
 *   [react_4_t1]: number,
 *   [react_4_t2]: number,
 *   [react_4_t3]: number,
 *   [react_4_t4]: number,
 *   [act_reset]: number,
 *   [react_reset]: number,
 *   [act_demand]: number,
 *   [act_demand_max]: number,
 *   [act_demand_rev]: number,
 *   [act_demand_max_rev]: number,
 *   [react_demand]: number,
 *   [react_demand_max]: number,
 *   [react_demand_rev]: number,
 *   [react_demand_max_rev]: number,
 *   [serial]: string,
 *   [id]: number,
 *   [fw]: number,
 *   [hw]: number,
 *   [fw_checksum]: number,
 *   [time]: number,
 *   [scroll_time]: number,
 *   [baud_rate]: BAUD_RATE,
 *   [parity]: PARITY,
 *   [stop_bits]: STOP_BITS,
 *   [combined_code]: COMBINED_CODE,
 *   [demand_mode]: DEMAND_MODE,
 *   [demand_cycle]: number,
 *   [display_mode]: string,
 *   [password]: string,
 *   [running_time]: number,
 *   [startup_current]: number,
 * }} STATE
 */

/**
 * @type {Object<string, BAUD_RATE>}
 */
const READ_BAUD_RATE_MAP = {
    6: 9600,
    7: 19200,
    8: 38400,
    9: 115200,
}
/**
 * @type {Object<BAUD_RATE, number>}
 */
const WRITE_BAUD_RATE_MAP = {
    9600: 6,
    19200: 7,
    38400: 8,
    115200: 9,
}

/**
 * @type {Object<string, PARITY>}
 */
const READ_PARITY_MAP = {
    0: 'none',
    1: 'odd',
    2: 'even',
}
/**
 * @type {Object<PARITY, number>}
 */
const WRITE_PARITY_MAP = {
    none: 0,
    odd: 1,
    even: 2,
}

/**
 * @type {Object<string, STOP_BITS>}
 */
const READ_STOP_BITS_MAP = {
    1: 1,
    2: 2,
}

/**
 * @type {Object<STOP_BITS, number>}
 */
const WRITE_STOP_BITS_MAP = {
    1: 1,
    2: 2,
}

/**
 * @type {Object<string, COMBINED_CODE>}
 */
const READ_COMBINED_CODE_MAP = {
    1: 'forward',
    2: 'reverse',
    3: 'forward+reverse',
    4: 'forward-reverse',
}

/**
 * @type {Object<COMBINED_CODE, number>}
 */
const WRITE_COMBINED_CODE_MAP = {
    'forward': 1,
    'reverse': 2,
    'forward+reverse': 3,
    'forward-reverse': 4,
}

/**
 * @type {Object<string, DEMAND_MODE>}
 */
const READ_DEMAND_MODE_MAP = {
    0: 'interval',
    1: 'slip',
}

/**
 * @type {Object<DEMAND_MODE, number>}
 */
const WRITE_DEMAND_MODE_MAP = {
    'interval': 0,
    'slip': 1,
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
 */
const writeStopBits = (val) => WRITE_STOP_BITS_MAP[val]

/**
 * @param {number} val
 * @return {COMBINED_CODE}
 */
const readCombinedCode = (val) => READ_COMBINED_CODE_MAP[val]

/**
 * @param {COMBINED_CODE} val
 */
const writeCombinedCode = (val) => WRITE_COMBINED_CODE_MAP[val]

/**
 * @param {number} val
 * @return {DEMAND_MODE}
 */
const readDemandMode = (val) => READ_DEMAND_MODE_MAP[val]

/**
 * @param {DEMAND_MODE} val
 */
const writeDemandMode = (val) => WRITE_DEMAND_MODE_MAP[val]

/**
 * @param {Array<number>} data
 * @param {number} [count=8]
 * @return {string}
 */
const readTimeTable = (data, count = 8) => {
    const getByte = (index, offset) => {
        const byteIndex = (index * 3 + offset)
        const word = data[byteIndex >> 1]
        return byteIndex & 1 ? word & 0xFF : word >> 8
    }

    return Array.from({length: count}).map((_, i) => [
        getByte(i, 0),
        getByte(i, 1),
        getByte(i, 2),
    ])
}

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
const writeLong = (value) => [value >> 16, value & 0xFFFF]
/**
 * @param {number} lsb
 * @param {number} msb
 * @return {number}
 */
const readLongBig = (lsb, msb) => msb << 16 | lsb
/**
 * @param {number} value
 * @return {Array<number>}
 */
const writeLongBig = (value) => [value & 0xFFFF, value >> 16]
/**
 * Write a number as a hex string - e.g. 1234 -> 0x1234
 * @param {number} value
 * @returns {number}
 */
const writeHexNum = (value) => Number.parseInt(value.toString(10), 16)

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @return {Promise<STATE>}
 */
async function read(
    client, {
        read: {
            instantaneous = true,
            energy = true,
            quadrants = true,
            system = true,
            time = true,
            config = true,
            tariffs = false,
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
        const {data} = await client.readHoldingRegisters(0x100, 12)
        // voltage - int32 in V*1000
        result.v = readLong(data[0], data[1]) / 1000
        changed |= result.v !== state.v
        // current - int32 in A*1000 - includes forward and reverse
        result.c = readLong(data[2], data[3]) / 1000
        changed |= result.c !== state.c
        // active power - int32 in W
        result.ap = readLong(data[4], data[5])
        changed |= result.ap !== state.ap
        // apparent power - int32 in VA
        result.app = readLong(data[6], data[7])
        changed |= result.app !== state.app
        // reactive power - int32 in VAr
        result.rp = readLong(data[8], data[9])
        changed |= result.rp !== state.rp
        // frequency - int16 in Hz*10
        result.freq = data[10] / 10
        changed |= result.freq !== state.freq
        // power factor - int16 in %*1000
        result.pow = data[11] / 1000
        changed |= result.pow !== state.pow
    }

    if (energy) {
        const {data} = await client.readHoldingRegisters(0x10E, 60)
        // Total forward active energy - int32 in kWh*100
        result.tot_act = readLong(data[0], data[1]) / 100
        changed |= result.tot_act !== state.tot_act
        // T1 total forward active energy - int32 in kWh*100
        result.tot_act_t1 = readLong(data[2], data[3]) / 100
        changed |= result.tot_act_t1 !== state.tot_act_t1
        // T2 total forward active energy - int32 in kWh*100
        result.tot_act_t2 = readLong(data[4], data[5]) / 100
        changed |= result.tot_act_t2 !== state.tot_act_t2
        // T3 total forward active energy - int32 in kWh*100
        result.tot_act_t3 = readLong(data[6], data[7]) / 100
        changed |= result.tot_act_t3 !== state.tot_act_t3
        // T4 total forward active energy - int32 in kWh*100
        result.tot_act_t4 = readLong(data[8], data[9]) / 100
        changed |= result.tot_act_t4 !== state.tot_act_t4
        // Total reverse active energy - int32 in kWh*100
        result.tot_act_rev = readLong(data[10], data[11]) / 100
        changed |= result.tot_act_rev !== state.tot_act_rev
        // T1 total reverse active energy - int32 in kWh*100
        result.tot_act_rev_t1 = readLong(data[12], data[13]) / 100
        changed |= result.tot_act_rev_t1 !== state.tot_act_rev_t1
        // T2 total reverse active energy - int32 in kWh*100
        result.tot_act_rev_t2 = readLong(data[14], data[15]) / 100
        changed |= result.tot_act_rev_t2 !== state.tot_act_rev_t2
        // T3 total reverse active energy - int32 in kWh*100
        result.tot_act_rev_t3 = readLong(data[16], data[17]) / 100
        changed |= result.tot_act_rev_t3 !== state.tot_act_rev_t3
        // T4 total reverse active energy - int32 in kWh*100
        result.tot_act_rev_t4 = readLong(data[18], data[19]) / 100
        changed |= result.tot_act_rev_t4 !== state.tot_act_rev_t4
        // Total active energy - int32 in kWh*100
        result.act = readLong(data[20], data[21]) / 100
        changed |= result.act !== state.act
        // T1 total active energy - int32 in kWh*100
        result.act_t1 = readLong(data[22], data[23]) / 100
        changed |= result.act_t1 !== state.act_t1
        // T2 total active energy - int32 in kWh*100
        result.act_t2 = readLong(data[24], data[25]) / 100
        changed |= result.act_t2 !== state.act_t2
        // T3 total active energy - int32 in kWh*100
        result.act_t3 = readLong(data[26], data[27]) / 100
        changed |= result.act_t3 !== state.act_t3
        // T4 total active energy - int32 in kWh*100
        result.act_t4 = readLong(data[28], data[29]) / 100
        changed |= result.act_t4 !== state.act_t4
        // Total forward reactive energy - int32 in kVArh*100
        result.tot_react = readLong(data[30], data[31]) / 100
        changed |= result.tot_react !== state.tot_react
        // T1 total forward reactive energy - int32 in kVArh*100
        result.tot_react_t1 = readLong(data[32], data[33]) / 100
        changed |= result.tot_react_t1 !== state.tot_react_t1
        // T2 total forward reactive energy - int32 in kVArh*100
        result.tot_react_t2 = readLong(data[34], data[35]) / 100
        changed |= result.tot_react_t2 !== state.tot_react_t2
        // T3 total forward reactive energy - int32 in kVArh*100
        result.tot_react_t3 = readLong(data[36], data[37]) / 100
        changed |= result.tot_react_t3 !== state.tot_react_t3
        // T4 total forward reactive energy - int32 in kVArh*100
        result.tot_react_t4 = readLong(data[38], data[39]) / 100
        changed |= result.tot_react_t4 !== state.tot_react_t4
        // Total reverse reactive energy - int32 in kVArh*100
        result.tot_react_rev = readLong(data[40], data[41]) / 100
        changed |= result.tot_react_rev !== state.tot_react_rev
        // T1 total reverse reactive energy - int32 in kVArh*100
        result.tot_react_rev_t1 = readLong(data[42], data[43]) / 100
        changed |= result.tot_react_rev_t1 !== state.tot_react_rev_t1
        // T2 total reverse reactive energy - int32 in kVArh*100
        result.tot_react_rev_t2 = readLong(data[44], data[45]) / 100
        changed |= result.tot_react_rev_t2 !== state.tot_react_rev_t2
        // T3 total reverse reactive energy - int32 in kVArh*100
        result.tot_react_rev_t3 = readLong(data[46], data[47]) / 100
        changed |= result.tot_react_rev_t3 !== state.tot_react_rev_t3
        // T4 total reverse reactive energy - int32 in kVArh*100
        result.tot_react_rev_t4 = readLong(data[48], data[49]) / 100
        changed |= result.tot_react_rev_t4 !== state.tot_react_rev_t4
        // Total reactive energy - int32 in kVArh*100
        result.react = readLong(data[50], data[51]) / 100
        changed |= result.react !== state.react
        // T1 total reactive energy - int32 in kVArh*100
        result.react_t1 = readLong(data[52], data[53]) / 100
        changed |= result.react_t1 !== state.react_t1
        // T2 total reactive energy - int32 in kVArh*100
        result.react_t2 = readLong(data[54], data[55]) / 100
        changed |= result.react_t2 !== state.react_t2
        // T3 total reactive energy - int32 in kVArh*100
        result.react_t3 = readLong(data[56], data[57]) / 100
        changed |= result.react_t3 !== state.react_t3
        // T4 total reactive energy - int32 in kVArh*100
        result.react_t4 = readLong(data[58], data[59]) / 100
        changed |= result.react_t4 !== state.react_t4
    }

    if (quadrants) {
        const {data} = await client.readHoldingRegisters(0x14A, 60)
        // Total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1 = readLong(data[0], data[1]) / 100
        changed |= result.react_1 !== state.react_1
        // T1 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t1 = readLong(data[2], data[3]) / 100
        changed |= result.react_1_t1 !== state.react_1_t1
        // T2 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t2 = readLong(data[4], data[5]) / 100
        changed |= result.react_1_t2 !== state.react_1_t2
        // T3 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t3 = readLong(data[6], data[7]) / 100
        changed |= result.react_1_t3 !== state.react_1_t3
        // T4 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t4 = readLong(data[8], data[9]) / 100
        changed |= result.react_1_t4 !== state.react_1_t4
        // Total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2 = readLong(data[10], data[11]) / 100
        changed |= result.react_2 !== state.react_2
        // T1 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t1 = readLong(data[12], data[13]) / 100
        changed |= result.react_2_t1 !== state.react_2_t1
        // T2 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t2 = readLong(data[14], data[15]) / 100
        changed |= result.react_2_t2 !== state.react_2_t2
        // T3 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t3 = readLong(data[16], data[17]) / 100
        changed |= result.react_2_t3 !== state.react_2_t3
        // T4 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t4 = readLong(data[18], data[19]) / 100
        changed |= result.react_2_t4 !== state.react_2_t4
        // Total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3 = readLong(data[20], data[21]) / 100
        changed |= result.react_3 !== state.react_3
        // T1 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t1 = readLong(data[22], data[23]) / 100
        changed |= result.react_3_t1 !== state.react_3_t1
        // T2 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t2 = readLong(data[24], data[25]) / 100
        changed |= result.react_3_t2 !== state.react_3_t2
        // T3 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t3 = readLong(data[26], data[27]) / 100
        changed |= result.react_3_t3 !== state.react_3_t3
        // T4 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t4 = readLong(data[28], data[29]) / 100
        changed |= result.react_3_t4 !== state.react_3_t4
        // Total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4 = readLong(data[30], data[31]) / 100
        changed |= result.react_4 !== state.react_4
        // T1 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t1 = readLong(data[32], data[33]) / 100
        changed |= result.react_4_t1 !== state.react_4_t1
        // T2 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t2 = readLong(data[34], data[35]) / 100
        changed |= result.react_4_t2 !== state.react_4_t2
        // T3 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t3 = readLong(data[36], data[37]) / 100
        changed |= result.react_4_t3 !== state.react_4_t3
        // T4 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t4 = readLong(data[38], data[39]) / 100
        changed |= result.react_4_t4 !== state.react_4_t4
        // Resettable total active energy - int32 in kWh*100
        result.act_reset = readLong(data[40], data[41]) / 100
        changed |= result.act_reset !== state.act_reset
        // Resettable total reactive energy - int32 in kVArh*100
        result.react_reset = readLong(data[42], data[43]) / 100
        changed |= result.react_reset !== state.react_reset
        // forward active demand - int32 in W*10
        result.act_demand = readLong(data[44], data[45]) / 10
        changed |= result.act_demand !== state.act_demand
        // forward maximum active energy demand - int32 in W*10
        result.act_demand_max = readLong(data[46], data[47]) / 10
        changed |= result.act_demand_max !== state.act_demand_max
        // reverse active demand - int32 in W*10
        result.act_demand_rev = readLong(data[48], data[49]) / 10
        changed |= result.act_demand_rev !== state.act_demand_rev
        // reverse maximum active energy demand - int32 in W*10
        result.act_demand_max_rev = readLong(data[50], data[51]) / 10
        changed |= result.act_demand_max_rev !== state.act_demand_max_rev
        // forward reactive demand - int32 in VAr*10
        result.react_demand = readLong(data[52], data[53]) / 10
        changed |= result.react_demand !== state.react_demand
        // forward maximum reactive energy demand - int32 in VAr*10
        result.react_demand_max = readLong(data[54], data[55]) / 10
        changed |= result.react_demand_max !== state.react_demand_max
        // reverse reactive demand - int32 in VAr*10
        result.react_demand_rev = readLong(data[56], data[57]) / 10
        changed |= result.react_demand_rev !== state.react_demand_rev
        // reverse maximum reactive energy demand - int32 in VAr*10
        result.react_demand_max_rev = readLong(data[58], data[59]) / 10
        changed |= result.react_demand_max_rev !== state.react_demand_max_rev
    }

    if (system) {
        const data = await client.readHoldingRegisters(0x1000, 7)

        // Serial number - 12-bit serial number, the same as xxx ID, it needs to use 10h together,
        // hexadecimal, 0123 4567 8910H serial number is 012345678910
        result.serial = ('0'.repeat(4) + data.data[0].toString(16)).slice(-4) +
            ('0'.repeat(4) + data.data[1].toString(16)).slice(-4) +
            ('0'.repeat(4) + data.data[2].toString(16)).slice(-4)
        changed |= result.serial !== state.serial

        // modbus id - 8-bit modbus id
        result.id = data.data[3]
        changed |= result.id !== state.id

        // FW version - 8-bit firmware version
        result.fw = data.data[4]
        changed |= result.fw !== state.fw

        // HW version - 8-bit hardware version
        result.hw = data.data[5]
        changed |= result.hw !== state.hw

        // FW Checksum - 8-bit firmware checksum
        result.fw_checksum = data.data[6]
        changed |= result.fw_checksum !== state.fw_checksum
    }

    if (time) {
        const data = await client.readHoldingRegisters(0x1007, 5)

        // Time - year-2000, month, day, week, hour, minute, second
        result.time = new Date(
            2000 + Number.parseInt(data.data[0].toString(16), 10),
            Number.parseInt((data.data[1] >> 8).toString(16), 10) - 1,
            Number.parseInt((data.data[1] & 0xFF).toString(16), 10),
            // we don't need the week
            // Number.parseInt((data.data[2] >> 8).toString(16), 10),
            Number.parseInt((data.data[2] & 0xFF).toString(16), 10),
            Number.parseInt((data.data[3] >> 8).toString(16), 10),
            Number.parseInt((data.data[3] & 0xFF).toString(16), 10)
        ).getTime()
        changed |= result.time !== state.time

        // Scrolling time
        result.scroll_time = data.data[4]
        changed |= result.scroll_time !== state.scroll_time
    }

    if (config) {
        const data = await client.readHoldingRegisters(0x100C, 15)
        // Baud rate
        result.baud_rate = readBaudRate(data.data[0])
        changed |= result.baud_rate !== state.baud_rate
        // Parity
        result.parity = readParity(data.data[1])
        changed |= result.parity !== state.parity
        // Stop bits
        result.stop_bits = readStopBits(data.data[2])
        changed |= result.stop_bits !== state.stop_bits
        // Combined code
        result.combined_code = readCombinedCode(data.data[3])
        changed |= result.combined_code !== state.combined_code
        // Demand mode
        result.demand_mode = readDemandMode(data.data[4])
        changed |= result.demand_mode !== state.demand_mode
        // Demand cycle - in minutes
        result.demand_cycle = data.data[5]
        changed |= result.demand_cycle !== state.demand_cycle
        // Display mode
        result.display_mode = data.data.slice(6, 10).map(v => ('0'.repeat(3) + v.toString(16)).slice(-4)).join('')
        changed |= result.display_mode !== state.display_mode
        // Password
        result.password = ('0'.repeat(3) + data.data[10].toString(10)).slice(-4)
        changed |= result.password !== state.password

        // Meter running time (start calculation when the current is greater than the setting)
        result.running_time = readLongBig(data.data[11], data.data[12])
        changed |= result.running_time !== state.running_time

        // Unit mA(startup current by default, maximum current's 1.2 times)
        result.startup_current = readLongBig(data.data[13], data.data[14])
        changed |= result.startup_current !== state.startup_current
    }

    if (tariffs) {
        const data1 = await client.readHoldingRegisters(0x1700, 8 * 12)
        // Time period table 1 - hhmmNN*8
        result.timePeriod_1 = readTimeTable(data1.data.slice(0, 12))
        // Time period table 2 - hhmmNN*8
        result.timePeriod_2 = readTimeTable(data1.data.slice(12, 24))
        // Time period table 3 - hhmmNN*8
        result.timePeriod_3 = readTimeTable(data1.data.slice(24, 36))
        // Time period table 4 - hhmmNN*8
        result.timePeriod_4 = readTimeTable(data1.data.slice(36, 48))
        // Time period table 5 - hhmmNN*8
        result.timePeriod_5 = readTimeTable(data1.data.slice(48, 60))
        // Time period table 6 - hhmmNN*8
        result.timePeriod_6 = readTimeTable(data1.data.slice(60, 72))
        // Time period table 7 - hhmmNN*8
        result.timePeriod_7 = readTimeTable(data1.data.slice(72, 84))
        // Time period table 8 - hhmmNN*8
        result.timePeriod_8 = readTimeTable(data1.data.slice(84, 96))

        const data2 = await client.readHoldingRegisters(0x1760, 33)
        // Time zone table - MMDDNN*8
        result.timeZone = readTimeTable(data2.data.slice(0, 12))
        // Holidays table - MMDDNN*14
        result.holidays = readTimeTable(data2.data.slice(12, 33), 14)
    }

    const recentReport = maxMsBetweenReports === 0 || ((Date.now() - (state.lastReport || 0)) < maxMsBetweenReports)
    if (state.lastReport > 0 && !changed && recentReport) {
        return
    }

    state.lastReport = Date.now()
    if (instantaneous) {
        state.v = result.v
        state.c = result.c
        state.ap = result.ap
        state.app = result.app
        state.rp = result.rp
        state.freq = result.freq
        state.pow = result.pow
    }
    if (energy) {
        state.tot_act = result.tot_act
        state.tot_act_t1 = result.tot_act_t1
        state.tot_act_t2 = result.tot_act_t2
        state.tot_act_t3 = result.tot_act_t3
        state.tot_act_t4 = result.tot_act_t4
        state.tot_act_rev = result.tot_act_rev
        state.tot_act_rev_t1 = result.tot_act_rev_t1
        state.tot_act_rev_t2 = result.tot_act_rev_t2
        state.tot_act_rev_t3 = result.tot_act_rev_t3
        state.tot_act_rev_t4 = result.tot_act_rev_t4
        state.act = result.act
        state.act_t1 = result.act_t1
        state.act_t2 = result.act_t2
        state.act_t3 = result.act_t3
        state.act_t4 = result.act_t4
        state.tot_react = result.tot_react
        state.tot_react_t1 = result.tot_react_t1
        state.tot_react_t2 = result.tot_react_t2
        state.tot_react_t3 = result.tot_react_t3
        state.tot_react_t4 = result.tot_react_t4
        state.tot_react_rev = result.tot_react_rev
        state.tot_react_rev_t1 = result.tot_react_rev_t1
        state.tot_react_rev_t2 = result.tot_react_rev_t2
        state.tot_react_rev_t3 = result.tot_react_rev_t3
        state.tot_react_rev_t4 = result.tot_react_rev_t4
        state.react = result.react
        state.react_t1 = result.react_t1
        state.react_t2 = result.react_t2
        state.react_t3 = result.react_t3
        state.react_t4 = result.react_t4
    }
    if (quadrants) {
        state.react_1 = result.react_1
        state.react_1_t1 = result.react_1_t1
        state.react_1_t2 = result.react_1_t2
        state.react_1_t3 = result.react_1_t3
        state.react_1_t4 = result.react_1_t4
        state.react_2 = result.react_2
        state.react_2_t1 = result.react_2_t1
        state.react_2_t2 = result.react_2_t2
        state.react_2_t3 = result.react_2_t3
        state.react_2_t4 = result.react_2_t4
        state.react_3 = result.react_3
        state.react_3_t1 = result.react_3_t1
        state.react_3_t2 = result.react_3_t2
        state.react_3_t3 = result.react_3_t3
        state.react_3_t4 = result.react_3_t4
        state.react_4 = result.react_4
        state.react_4_t1 = result.react_4_t1
        state.react_4_t2 = result.react_4_t2
        state.react_4_t3 = result.react_4_t3
        state.react_4_t4 = result.react_4_t4
        state.act_reset = result.act_reset
        state.react_reset = result.react_reset
        state.act_demand = result.act_demand
        state.act_demand_max = result.act_demand_max
        state.act_demand_rev = result.act_demand_rev
        state.act_demand_max_rev = result.act_demand_max_rev
        state.react_demand = result.react_demand
        state.react_demand_max = result.react_demand_max
        state.react_demand_rev = result.react_demand_rev
        state.react_demand_max_rev = result.react_demand_max_rev
    }
    if (system) {
        state.serial = result.serial
        state.id = result.id
        state.fw = result.fw
        state.hw = result.hw
        state.fw_checksum = result.fw_checksum
    }
    if (time) {
        state.time = result.time
        state.scroll_time = result.scroll_time
    }
    if (config) {
        state.baud_rate = result.baud_rate
        state.parity = result.parity
        state.stop_bits = result.stop_bits
        state.combined_code = result.combined_code
        state.demand_mode = result.demand_mode
        state.demand_cycle = result.demand_cycle
        state.display_mode = result.display_mode
        state.password = result.password
        state.running_time = result.running_time
        state.startup_current = result.startup_current
    }

    return result
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [time]: number,
 *   [scroll_time]: number,
 * }} values
 * @param {CONFIG} [config]
 * @param {STATE} [state]
 * @returns {Promise<void>}
 */
async function write(client, values, config, state = {}) {
    if (values.time != null) {
        const time = new Date(values.time)
        await client.writeRegisters(0x1007, [
            writeHexNum(time.getFullYear() - 2000),
            writeHexNum(time.getMonth() + 1) << 8 | writeHexNum(time.getDate()),
            writeHexNum(time.getDay()) << 8 | writeHexNum(time.getHours()),
            writeHexNum(time.getMinutes()) << 8 | writeHexNum(time.getSeconds()),
        ])
    }
    if (values.scroll_time != null) {
        await client.writeRegisters(0x100C, [values.scroll_time])
    }
}

/**
 * Setup communication parameters - changes are applied after device restart
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [serial]: string,
 *   [address]: number,
 *   [baudRate]: BAUD_RATE,
 *   [parity]: PARITY,
 *   [stopBits]: STOP_BITS,
 *   [combinedCode]: COMBINED_CODE,
 *   [demandMode]: DEMAND_MODE,
 *   [demandCycle]: number,
 *   [displayMode]: string,
 *   [password]: string,
 *   [runningTime]: number,
 *   [startupCurrent]: number,
 * }} newConfig
 * @return {Promise<void>}
 */
async function setup(client, newConfig) {
    if (newConfig.serial != null) {
        const serial = ('0'.repeat(11) + newConfig.serial).slice(-12)
        await client.writeRegisters(0x1000, [
            parseInt(serial.slice(0, 4), 16),
            parseInt(serial.slice(4, 8), 16),
            parseInt(serial.slice(8, 12), 16),
        ])
    }
    if (newConfig.address != null) {
        await client.writeRegisters(0x1003, [newConfig.address])
        client.setID(newConfig.address)
    }
    if (newConfig.baudRate != null) {
        await client.writeRegisters(0x100C, [writeBaudRate(newConfig.baudRate)])
    }
    if (newConfig.parity != null) {
        await client.writeRegisters(0x100D, [writeParity(newConfig.parity)])
    }
    if (newConfig.stopBits != null) {
        await client.writeRegisters(0x100E, [writeStopBits(newConfig.stopBits)])
    }
    if (newConfig.combinedCode != null) {
        await client.writeRegisters(0x100F, [writeCombinedCode(newConfig.combinedCode)])
    }
    if (newConfig.demandMode != null) {
        await client.writeRegisters(0x1010, [writeDemandMode(newConfig.demandMode)])
    }
    if (newConfig.demandCycle != null) {
        await client.writeRegisters(0x1011, [newConfig.demandCycle])
    }
    if (newConfig.displayMode != null) {
        await client.writeRegisters(0x1012, newConfig.displayMode.match(/.{1,4}/g).slice(0, 4).map(v => parseInt(v, 16)))
    }
    if (newConfig.password != null) {
        await client.writeRegisters(0x1016, [parseInt(newConfig.password, 10)])
    }
    if (newConfig.runningTime != null) {
        await client.writeRegisters(0x1018, writeLongBig(newConfig.runningTime))
    }
    if (newConfig.startupCurrent != null) {
        await client.writeRegisters(0x101A, writeLongBig(newConfig.startupCurrent))
    }
}

module.exports = {
    read,
    write,
    setup,
}

