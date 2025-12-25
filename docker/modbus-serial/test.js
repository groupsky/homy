const ModbusRTU = require("modbus-serial");

const run = async () => {
    const baudRate = 9600
    const parity = 'none'
    const client = new ModbusRTU();
    await client.connectRTU("/dev/ttyACM0", {
        baudRate: baudRate,
        parity: parity,
    });
    try {
        client.setTimeout(250);
        const deviceId = 52
        client.setID(deviceId);
        try {
            const val = await client.readHoldingRegisters(0x104, 1)
            console.log(val);
        } catch (e) {
            console.error('Failed to read from device', e);
        }
    } finally {
        await client.close();
    }
}

run().catch(console.error);
