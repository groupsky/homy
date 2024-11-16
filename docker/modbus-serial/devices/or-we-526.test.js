const {describe, expect, it, jest} = require('@jest/globals')
const {read, write, setup} = require('./or-we-526')

describe('read', () => {
    it('should read instantaneous parameters', async () => {
        const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
            data: [
                // voltage - 1234567.890 - int32 in V*1000
                0x4996, 0x02D2,
                // current - 122345.678 - int32 in A*1000
                0x074A, 0xD8CE,
                // active power - 123456 - int32 in W
                0x0001, 0xE240,
                // apparent power - 234567 - int32 in VA
                0x0003, 0x9447,
                // reactive power - 3456789 - int32 in VAr
                0x0034, 0xBF15,
                // frequency - 50.1 - int16 in Hz*10
                0x01F5,
                // power factor - 45.678 - int16 in %*1000
                0xB26E,
            ]
        })
        expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
            {
                read: {
                    instantaneous: true,
                    energy: false,
                    quadrants: false,
                    system: false,
                    time: false,
                    config: false,
                    tariffs: false,
                }
            }
        )).toEqual({
            v: 1234567.890,
            c: 122345.678,
            ap: 123456,
            app: 234567,
            rp: 3456789,
            freq: 50.1,
            pow: 45.678
        })
        expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
        expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x0100, 12)
    })

    it('should read energy parameters', async () => {
        const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
            data: [
                // Total forward active energy - 1234.56 - int32 in kWh*100
                0x0001, 0xE240,
                // T1 total forward active energy - 2345.67 - int32 in kWh*100
                0x0003, 0x9447,
                // T2 total forward active energy - 3456.78 - int32 in kWh*100
                0x0005, 0x464E,
                // T3 total forward active energy - 4567.89 - int32 in kWh*100
                0x0006, 0xF855,
                // T4 total forward active energy - 5678.90 - int32 in kWh*100
                0x0008, 0xAA52,
                // Total reverse active energy - 6789.01 - int32 in kWh*100
                0x000A, 0x5BF5,
                // T1 total reverse active energy - 7890.12 - int32 in kWh*100
                0x000C, 0x0A14,
                // T2 total reverse active energy- 8901.23 - int32 in kWh*100
                0x000D, 0x950B,
                // T3 total reverse active energy - 9012.34 - int32 in kWh*100
                0x000D, 0xC072,
                // T4 total reverse active energy - 5123.45 - int32 in kWh*100
                0x0007, 0xD159,
                // Total active energy - 2134.56 - int32 in kWh*100
                0x0003, 0x41D0,
                // T1 total active energy - 3245.67 - int32 in kWh*100
                0x0004, 0xF3D7,
                // T2 total active energy - 4356.78 - int32 in kWh*100
                0x0006, 0xA5DE,
                // T3 total active energy - 5467.89 - int32 in kWh*100
                0x0008, 0x57E5,
                // T4 total active energy - 6578.90 - int32 in kWh*100
                0x000A, 0x09E2,
                // Total forward reactive energy - 7654.32 - int32 in kVArh*100
                0x000B, 0xADF8,
                // T1 total forward reactive energy - 8765.43 - int32 in kVArh*100
                0x000D, 0x5FFF,
                // T2 total forward reactive energy - 9876.54 - int32 in kVArh*100
                0x000F, 0x1206,
                // T3 total forward reactive energy - 5987.65 - int32 in kVArh*100
                0x0009, 0x22ED,
                // T4 total forward reactive energy - 1098.76 - int32 in kVArh*100
                0x0001, 0xAD34,
                // Total reverse reactive energy - 2109.87 - int32 in kVArh*100
                0x0003, 0x382B,
                // T1 total reverse reactive energy - 3210.98 - int32 in kVArh*100
                0x0004, 0xE64A,
                // T2 total reverse reactive energy - 4321.09 - int32 in kVArh*100
                0x0006, 0x97ED,
                // T3 total reverse reactive energy - 5432.10 - int32 in kVArh*100
                0x0008, 0x49EA,
                // T4 total reverse reactive energy - 6543.21 - int32 in kVArh*100
                0x0009, 0xFBF1,
                // Total reactive energy - 7654.32 - int32 in kVArh*100
                0x000B, 0xADF8,
                // T1 total reactive energy - 8765.43 - int32 in kVArh*100
                0x000D, 0x5FFF,
                // T2 total reactive energy - 9876.54 - int32 in kVArh*100
                0x000F, 0x1206,
                // T3 total reactive energy - 1357.89 - int32 in kVArh*100
                0x0002, 0x126D,
                // T4 total reactive energy - 2468.90 - int32 in kVArh*100
                0x0003, 0xC46A,
            ]
        })
        expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
            {
                read: {
                    instantaneous: false,
                    energy: true,
                    quadrants: false,
                    system: false,
                    time: false,
                    config: false,
                    tariffs: false,
                }
            }
        )).toEqual({
            tot_act: 1234.56,
            tot_act_t1: 2345.67,
            tot_act_t2: 3456.78,
            tot_act_t3: 4567.89,
            tot_act_t4: 5678.90,
            tot_act_rev: 6789.01,
            tot_act_rev_t1: 7890.12,
            tot_act_rev_t2: 8901.23,
            tot_act_rev_t3: 9012.34,
            tot_act_rev_t4: 5123.45,
            act: 2134.56,
            act_t1: 3245.67,
            act_t2: 4356.78,
            act_t3: 5467.89,
            act_t4: 6578.90,
            tot_react: 7654.32,
            tot_react_t1: 8765.43,
            tot_react_t2: 9876.54,
            tot_react_t3: 5987.65,
            tot_react_t4: 1098.76,
            tot_react_rev: 2109.87,
            tot_react_rev_t1: 3210.98,
            tot_react_rev_t2: 4321.09,
            tot_react_rev_t3: 5432.10,
            tot_react_rev_t4: 6543.21,
            react: 7654.32,
            react_t1: 8765.43,
            react_t2: 9876.54,
            react_t3: 1357.89,
            react_t4: 2468.90,
        })
        expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
        expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x10E, 60)
    })

    it('should read quadrants parameters', async () => {
        const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
            data: [
                // Total reactive energy in the first quadrant - 1234.56 - int32 in kVArh*100
                0x0001, 0xE240,
                // T1 total reactive energy in the first quadrant - 2345.67 - int32 in kVArh*100
                0x0003, 0x9447,
                // T2 total reactive energy in the first quadrant - 3456.78 - int32 in kVArh*100
                0x0005, 0x464E,
                // T3 total reactive energy in the first quadrant - 4567.89 - int32 in kVArh*100
                0x0006, 0xF855,
                // T4 total reactive energy in the first quadrant - 5678.90 - int32 in kVArh*100
                0x0008, 0xAA52,
                // Total reactive energy in the second quadrant - 6789.01 - int32 in kVArh*100
                0x000A, 0x5BF5,
                // T1 total reactive energy in the second quadrant - 7890.12 - int32 in kVArh*100
                0x000C, 0x0A14,
                // T2 total reactive energy in the second quadrant - 8901.23 - int32 in kVArh*100
                0x000D, 0x950B,
                // T3 total reactive energy in the second quadrant - 9012.34 - int32 in kVArh*100
                0x000D, 0xC072,
                // T4 total reactive energy in the second quadrant - 5123.45 - int32 in kVArh*100
                0x0007, 0xD159,
                // Total reactive energy in the third quadrant - 1023.45 - int32 in kVArh*100
                0x0001, 0x8FC9,
                // T1 total reactive energy in the third quadrant - 2134.56 - int32 in kVArh*100
                0x0003, 0x41D0,
                // T2 total reactive energy in the third quadrant - 3245.67 - int32 in kVArh*100
                0x0004, 0xF3D7,
                // T3 total reactive energy in the third quadrant - 4356.78 - int32 in kVArh*100
                0x0006, 0xA5DE,
                // T4 total reactive energy in the third quadrant - 5467.89 - int32 in kVArh*100
                0x0008, 0x57E5,
                // Total reactive energy in the fourth quadrant - 6578.90 - int32 in kVArh*100
                0x000A, 0x09E2,
                // T1 total reactive energy in the fourth quadrant - 7689.01 - int32 in kVArh*100
                0x000B, 0xBB85,
                // T2 total reactive energy in the fourth quadrant - 8790.12 - int32 in kVArh*100
                0x000D, 0x69A4,
                // T3 total reactive energy in the fourth quadrant - 9801.23 - int32 in kVArh*100
                0x000E, 0xF49B,
                // T4 total reactive energy in the fourth quadrant - 5123.45 - int32 in kVArh*100
                0x0007, 0xD159,
                // Resettable total active energy - 1098.76 - int32 in kWh*100
                0x0001, 0xAD34,
                // Resettable total reactive energy - 2109.87 - int32 in kVArh*100
                0x0003, 0x382B,
                // forward active demand - 32109.8 - int32 in W*10
                0x0004, 0xE64A,
                // forward maximum active energy demand - 43210.9 - int32 in W*10
                0x0006, 0x97ED,
                // reverse active demand - 54321.0 - int32 in W*10
                0x0008, 0x49EA,
                // reverse maximum active energy demand - 65432.1 - int32 in W*10
                0x0009, 0xFBF1,
                // forward reactive demand - 76543.2 - int32 in VAr*10
                0x000B, 0xADF8,
                // forward maximum reactive energy demand - 87654.3 - int32 in VAr*10
                0x000D, 0x5FFF,
                // reverse reactive demand - 98765.4 - int32 in VAr*10
                0x000F, 0x1206,
                // reverse maximum reactive energy demand - 59876.5 - int32 in VAr*10
                0x0009, 0x22ED,
            ]
        })
        expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
            {
                read: {
                    instantaneous: false,
                    energy: false,
                    quadrants: true,
                    system: false,
                    time: false,
                    config: false,
                    tariffs: false,
                }
            }
        )).toEqual({
            react_1: 1234.56,
            react_1_t1: 2345.67,
            react_1_t2: 3456.78,
            react_1_t3: 4567.89,
            react_1_t4: 5678.90,
            react_2: 6789.01,
            react_2_t1: 7890.12,
            react_2_t2: 8901.23,
            react_2_t3: 9012.34,
            react_2_t4: 5123.45,
            react_3: 1023.45,
            react_3_t1: 2134.56,
            react_3_t2: 3245.67,
            react_3_t3: 4356.78,
            react_3_t4: 5467.89,
            react_4: 6578.90,
            react_4_t1: 7689.01,
            react_4_t2: 8790.12,
            react_4_t3: 9801.23,
            react_4_t4: 5123.45,
            act_reset: 1098.76,
            react_reset: 2109.87,
            act_demand: 32109.8,
            act_demand_max: 43210.9,
            act_demand_rev: 54321.0,
            act_demand_max_rev: 65432.1,
            react_demand: 76543.2,
            react_demand_max: 87654.3,
            react_demand_rev: 98765.4,
            react_demand_max_rev: 59876.5,
        })
        expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
        expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x14A, 60)
    })

    it('should read system parameters', async () => {
        const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
            data: [
                // Serial number - 12-bit serial number, the same as xxx ID, it needs to use 10h together,
                0x0123, 0x4567, 0x8910,
                // modbus id - 8-bit modbus id
                0x12,
                // FW version - 8-bit firmware version
                0x34,
                // HW version - 8-bit hardware version
                0x56,
                // FW Checksum - 8-bit firmware checksum
                0x78,
            ]
        })
        expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
            {
                read: {
                    instantaneous: false,
                    energy: false,
                    quadrants: false,
                    system: true,
                    time: false,
                    config: false,
                    tariffs: false,
                }
            }
        )).toEqual({
            serial: "012345678910",
            id: 0x12,
            fw: 0x34,
            hw: 0x56,
            fw_checksum: 0x78,
        })
        expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
        expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x1000, 7)
    })

    it('should read time parameters', async () => {
        const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
            data: [
                // Time - year-2000, month, day, week, hour, minute, second
                0x0024, // 2024 year
                0x0921, // 31 September
                0x0312, // Wednesday, 12 hours
                0x3456, // 34 minutes, 56 seconds
                // Scrolling time
                15
            ]
        })
        expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
            {
                read: {
                    instantaneous: false,
                    energy: false,
                    quadrants: false,
                    system: false,
                    time: true,
                    config: false,
                    tariffs: false,
                }
            }
        )).toEqual({
            time: new Date(2024, 8, 21, 12, 34, 56).getTime(),
            scroll_time: 15,
        })
        expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
        expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x1007, 5)
    })

    it('should read config parameters', async () => {
        const mockReadHoldingRegisters = jest.fn().mockResolvedValueOnce({
            data: [
                // Baud rate - 9600
                6,
                // Parity - even
                2,
                // Stop bits - 1
                1,
                // Combined code - forward+reverse
                3,
                // Demand mode - interval
                0,
                // Demand cycle - 20
                20,
                // Display mode
                0x0000, 0x0000, 0x0000, 0xffff,
                // Password - 0123
                123,
                // Meter running time - 1234567890
                0x02D2, 0x4996,
                // Unit mA - 987654321
                0x68B1, 0x3ADE,
            ]
        })
        expect(await read({readHoldingRegisters: mockReadHoldingRegisters},
            {
                read: {
                    instantaneous: false,
                    energy: false,
                    quadrants: false,
                    system: false,
                    time: false,
                    config: true,
                    tariffs: false,
                }
            }
        )).toEqual({
            baud_rate: 9600,
            parity: 'even',
            stop_bits: 1,
            combined_code: 'forward+reverse',
            demand_mode: 'interval',
            demand_cycle: 20,
            display_mode: '000000000000ffff',
            password: '0123',
            running_time: 1234567890,
            startup_current: 987654321,
        })
        expect(mockReadHoldingRegisters).toHaveBeenCalledTimes(1)
        expect(mockReadHoldingRegisters).toHaveBeenCalledWith(0x100C, 15)
    })
})

describe('write', () => {
    it('should write time parameter', async () => {
        const mockWriteRegisters = jest.fn()
        await write({writeRegisters: mockWriteRegisters}, {
            time: new Date(2024, 8, 21, 12, 34, 56).getTime(),
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1007, [
            0x0024, // 2024 year
            0x0921, // 21 September
            0x0612, // Saturday, 12 hours
            0x3456, // 34 minutes, 56 seconds
        ])
    })

    it('should write scrolling time parameter', async () => {
        const mockWriteRegisters = jest.fn()
        await write({writeRegisters: mockWriteRegisters}, {
            scroll_time: 15,
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x100C, [15])
    })
})

describe('setup', () => {
    it('should setup serial number', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            serial: "012345678910"
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1000, [0x0123, 0x4567, 0x8910])
    })

    it('should setup modbus id', async () => {
        const mockWriteRegisters = jest.fn()
        const mockSetId = jest.fn()
        await setup({writeRegisters: mockWriteRegisters, setID: mockSetId}, {
            address: 0x12
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1003, [0x12])
        expect(mockSetId).toHaveBeenCalledTimes(1)
        expect(mockSetId).toHaveBeenCalledWith(0x12)
    })

    it('should setup baud rate', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            baudRate: 19200
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x100C, [7])
    })

    it('should setup parity', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            parity: 'odd'
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x100D, [1])
    })

    it('should setup stop bits', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            stopBits: 2
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x100E, [2])
    })

    it('should setup combined code', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            combinedCode: 'forward+reverse'
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x100F, [3])
    })

    it('should setup demand mode', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            demandMode: 'slip'
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1010, [1])
    })

    it('should setup demand cycle', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            demandCycle: 20
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1011, [20])
    })

    it('should setup display mode', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            displayMode: '1234567890abcdef'
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1012, [0x1234, 0x5678, 0x90ab, 0xcdef])
    })

    it('should setup password', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            password: '0123'
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1016, [123])
    })

    it('should setup meter running time', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            runningTime: 1234567890
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x1018, [0x02D2, 0x4996])
    })

    it('should setup unit mA', async () => {
        const mockWriteRegisters = jest.fn()
        await setup({writeRegisters: mockWriteRegisters}, {
            startupCurrent: 987654321
        })
        expect(mockWriteRegisters).toHaveBeenCalledTimes(1)
        expect(mockWriteRegisters).toHaveBeenCalledWith(0x101A, [0x68B1, 0x3ADE])
    })
})
