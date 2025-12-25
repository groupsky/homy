// create an empty modbus client
const ModbusRTU = require("modbus-serial");
const client = new ModbusRTU();

// open connection to a tcp line
client.connectTCP("192.168.68.198", {port: 502});
client.setID(1);

const readLong = (msb, lsb) => msb << 16 | lsb
const writeLong = (value) => [value >> 16, value & 0xFFFF]

// read the values of 10 registers starting at address 0
// on device number 1. and log the values to the console.

async function search() {
    for (let i = 0x7F00; i < 0xFFFF; i += 0x100) {
        try {
            console.log(i);
            const res = await client.readHoldingRegisters(i, 0x02);
            console.log(i, res)
        } catch (e) {
        }
    }
}

setTimeout(async function () {
    {
        let data

        data = await client.writeRegisters(40126, writeLong(500))
        console.log(data)

        // Fixed active power derated
        data = await client.readHoldingRegisters(40126, 2)
        const fixed_active_power_derated = readLong(data.data[0], data.data[1])
        console.log('Fixed active power derated', fixed_active_power_derated)
        return

        data = await client.readHoldingRegisters(32106, 2);
        // Accumulated energy yield (kWh) * 100
        const total_p = readLong(data.data[0], data.data[1]) / 100

        data = await client.readHoldingRegisters(32114, 2);
        // Daily energy yield (kWh) * 100
        const daily_p = readLong(data.data[0], data.data[1]) / 100

        data = await client.readHoldingRegisters(32080, 9)
        // Active power (kW) * 1000
        const ap = readLong(data.data[0], data.data[1]) / 1000
        // Reactive power (kVar) * 1000
        const rp = readLong(data.data[2], data.data[3]) / 1000
        // Power factor (1) * 1000
        const pf = data.data[4] / 1000
        // Grid frequency (Hz) * 100
        const freq = data.data[5] / 100
        // Efficiency (%) * 100
        const eff = data.data[6] / 100
        // Internal temperature (°C) * 10
        const temp = data.data[7] / 10
        // Insulation resistance (MΩ) * 1000
        const ins = data.data[8] / 1000

        const newValues = {
            total_p,
            daily_p,
            ap,
            rp,
            pf,
            freq,
            eff,
            temp,
            ins,
        }

        console.log(newValues)
        return
    }

    let data
    try {
        data = await client.readHoldingRegisters(32106, 2);
        // Accumulated energy yield (kWh) * 100
        const total_p = readLong(data.data[0], data.data[1]) / 100

        data = await client.readHoldingRegisters(32114, 2);
        // Daily energy yield (kWh) * 100
        const daily_p = readLong(data.data[0], data.data[1]) / 100

        data = await client.readHoldingRegisters(32080, 9)
        // Active power (kW) * 1000
        const ap = readLong(data.data[0], data.data[1]) / 1000
        // Reactive power (kVar) * 1000
        const rp = readLong(data.data[2], data.data[3]) / 1000
        // Power factor (1) * 1000
        const pf = data.data[4] / 1000
        // Grid frequency (Hz) * 100
        const freq = data.data[5] / 100
        // Efficiency (%) * 100
        const eff = data.data[6] / 100
        // Internal temperature (°C) * 10
        const temp = data.data[7] / 10
        // Insulation resistance (MΩ) * 1000
        const ins = data.data[8] / 1000

        console.log({
            total_p,
            daily_p,
            ap,
            rp,
            pf,
            freq,
            eff,
            temp,
            ins,
        })
        return

        data = await client.readHoldingRegisters(32106, 2);
        console.log('Accumulated energy yield', data)
        data = await client.readHoldingRegisters(32114, 2);
        console.log('Daily energy yield', data)
        return

        // data = await client.readHoldingRegisters(0x9C40, 0x40);
        // console.log('0x9C40', data)
        // data = await client.readHoldingRegisters(0x9C80, 0x40);
        // console.log('0x9C80', data)
        data = await client.readHoldingRegisters(40000, 2);
        console.log('System time', new Date((data.data[0] * 0x10000 + data.data[1]) * 1000))

        data = await client.readHoldingRegisters(40500, 0x40);
        console.log('PV1 V', data.data[0] / 10)
        console.log('PV2 V', data.data[1] / 10)
        console.log('PV3 V', data.data[2] / 10)
        console.log('PV4 V', data.data[3] / 10)
        console.log('PV5 V', data.data[4] / 10)
        console.log('PV6 V', data.data[5] / 10)
        console.log('PV1 I', data.data[6] / 100)
        console.log('PV2 I', data.data[7] / 100)
        console.log('PV3 I', data.data[8] / 100)
        console.log('PV4 I', data.data[9] / 100)
        console.log('PV5 I', data.data[10] / 100)
        console.log('PV6 I', data.data[11] / 100)
        console.log('Uab', data.data[27] / 100)
        console.log('Ubc', data.data[28] / 100)
        console.log('Uca', data.data[29] / 100)
        console.log('Pf', data.data[32] / 1000)
        console.log('Tcab', data.data[33] / 10)
        console.log('Freq', data.data[46] / 100)
        for (let i = 40564; i < 40939; i++) {
            try {
                data = await client.readHoldingRegisters(i, 2);
                console.log(i, data.data)
            } catch (e) {

            }
        }

        data = await client.readHoldingRegisters(40118, 4);
        console.log('active power control', data.data[0])
        console.log('Active power deration setting [percentage] ', data.data[1], '%')
        console.log('Active power deration setting [fixed value]', data.data[2] / 10)
        console.log('Active power deration gradient', data.data[3] / 10)

        return

        data = await client.readHoldingRegisters(0x7D00, 0x40);
        console.log('0x7D00', data)
        data = await client.readHoldingRegisters(0x7D40, 0x40);
        console.log('0x7D40', data)
        data = await client.readHoldingRegisters(0x7D80, 0x40);
        console.log('0x7D80', data)
        data = await client.readHoldingRegisters(0x7DB0, 0x40);
        console.log('0x7DB0', data)
        data = await client.readHoldingRegisters(0x7E00, 0x40);
        console.log('0x7E00', data)
        data = await client.readHoldingRegisters(0x7E40, 0x40);
        console.log('0x7E40', data)

        data = await client.readHoldingRegisters(0xA800, 0x40);
        console.log('0xA800', data)
        data = await client.readHoldingRegisters(0xA840, 0x40);
        console.log('0xA840', data)
        data = await client.readHoldingRegisters(0xA880, 0x40);
        console.log('0xA880', data)
        data = await client.readHoldingRegisters(0xA8B0, 0x40);
        console.log('0xA8B0', data)

        data = await client.readHoldingRegisters(0xB800, 0x40);
        console.log('0xB800', data)
        data = await client.readHoldingRegisters(0xB880, 0x40);
        console.log('0xB880', data)
        data = await client.readHoldingRegisters(0xB8B0, 0x40);
        console.log('0xB8B0', data)
    } catch (e) {
        console.log('error', e)
    }
    // search()
}, 1000);
