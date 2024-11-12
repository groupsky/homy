// https://www.orno.pl/en/energy-meters-with-mid/346--5908254827853.html

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
async function read(
    client, {
        read: {
            instantaneous = true,
            energy = true,
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
        const {data} = await client.readHoldingRegisters(0x100, 11)
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
        const {data} = await client.readHoldingRegisters(0x10E, 120)
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
        // Total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1 = readLong(data[60], data[61]) / 100
        changed |= result.react_1 !== state.react_1
        // T1 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t1 = readLong(data[62], data[63]) / 100
        changed |= result.react_1_t1 !== state.react_1_t1
        // T2 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t2 = readLong(data[64], data[65]) / 100
        changed |= result.react_1_t2 !== state.react_1_t2
        // T3 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t3 = readLong(data[66], data[67]) / 100
        changed |= result.react_1_t3 !== state.react_1_t3
        // T4 total reactive energy in the first quadrant - int32 in kVArh*100
        result.react_1_t4 = readLong(data[68], data[69]) / 100
        changed |= result.react_1_t4 !== state.react_1_t4
        // Total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2 = readLong(data[70], data[71]) / 100
        changed |= result.react_2 !== state.react_2
        // T1 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t1 = readLong(data[72], data[73]) / 100
        changed |= result.react_2_t1 !== state.react_2_t1
        // T2 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t2 = readLong(data[74], data[75]) / 100
        changed |= result.react_2_t2 !== state.react_2_t2
        // T3 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t3 = readLong(data[76], data[77]) / 100
        changed |= result.react_2_t3 !== state.react_2_t3
        // T4 total reactive energy in the second quadrant - int32 in kVArh*100
        result.react_2_t4 = readLong(data[78], data[79]) / 100
        changed |= result.react_2_t4 !== state.react_2_t4
        // Total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3 = readLong(data[80], data[81]) / 100
        changed |= result.react_3 !== state.react_3
        // T1 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t1 = readLong(data[82], data[83]) / 100
        changed |= result.react_3_t1 !== state.react_3_t1
        // T2 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t2 = readLong(data[84], data[85]) / 100
        changed |= result.react_3_t2 !== state.react_3_t2
        // T3 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t3 = readLong(data[86], data[87]) / 100
        changed |= result.react_3_t3 !== state.react_3_t3
        // T4 total reactive energy in the third quadrant - int32 in kVArh*100
        result.react_3_t4 = readLong(data[88], data[89]) / 100
        changed |= result.react_3_t4 !== state.react_3_t4
        // Total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4 = readLong(data[90], data[91]) / 100
        changed |= result.react_4 !== state.react_4
        // T1 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t1 = readLong(data[92], data[93]) / 100
        changed |= result.react_4_t1 !== state.react_4_t1
        // T2 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t2 = readLong(data[94], data[95]) / 100
        changed |= result.react_4_t2 !== state.react_4_t2
        // T3 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t3 = readLong(data[96], data[97]) / 100
        changed |= result.react_4_t3 !== state.react_4_t3
        // T4 total reactive energy in the fourth quadrant - int32 in kVArh*100
        result.react_4_t4 = readLong(data[98], data[99]) / 100
        changed |= result.react_4_t4 !== state.react_4_t4
        // Resettable total active energy - int32 in kWh*100
        result.act_reset = readLong(data[100], data[101]) / 100
        changed |= result.act_reset !== state.act_reset
        // Resettable total reactive energy - int32 in kVArh*100
        result.react_reset = readLong(data[102], data[103]) / 100
        changed |= result.react_reset !== state.react_reset
        // forward active demand - int32 in W*10
        result.act_demand = readLong(data[104], data[105]) / 10
        changed |= result.act_demand !== state.act_demand
        // forward maximum active energy demand - int32 in W*10
        result.act_demand_max = readLong(data[106], data[107]) / 10
        changed |= result.act_demand_max !== state.act_demand_max
        // reverse active demand - int32 in W*10
        result.act_demand_rev = readLong(data[108], data[109]) / 10
        changed |= result.act_demand_rev !== state.act_demand_rev
        // reverse maximum active energy demand - int32 in W*10
        result.act_demand_max_rev = readLong(data[110], data[111]) / 10
        changed |= result.act_demand_max_rev !== state.act_demand_max_rev
        // forward reactive demand - int32 in VAr*10
        result.react_demand = readLong(data[112], data[113]) / 10
        changed |= result.react_demand !== state.react_demand
        // forward maximum reactive energy demand - int32 in VAr*10
        result.react_demand_max = readLong(data[114], data[115]) / 10
        changed |= result.react_demand_max !== state.react_demand_max
        // reverse reactive demand - int32 in VAr*10
        result.react_demand_rev = readLong(data[116], data[117]) / 10
        changed |= result.react_demand_rev !== state.react_demand_rev
        // reverse maximum reactive energy demand - int32 in VAr*10
        result.react_demand_max_rev = readLong(data[118], data[119]) / 10
        changed |= result.react_demand_max_rev !== state.react_demand_max_rev
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
    if (power) {
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
async function setup(client, newConfig) {
    if (newConfig.address != null) {
        await client.writeRegisters(0x110, [newConfig.address])
        client.setID(newConfig.address)
    }
    if (newConfig.baudRate != null || newConfig.parity != null) {
        const {data} = await client.readHoldingRegisters(0x111, 1)
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

