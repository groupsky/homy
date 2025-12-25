const ModbusRTU = require("modbus-serial");

const run = async () => {
    for (const baudRate of [9600, 14400, 19200]) {
        for (const parity of ['even', 'none', 'odd']) {
            if (baudRate === 9600 && parity === 'even') {
                continue
            }
            const client = new ModbusRTU();
            await client.connectRTU("/dev/ttyACM0", {
                baudRate: baudRate,
                parity: parity,
            });
            client.setTimeout(250);
            for (const deviceId of Array.from({length: 247}, (_, i) => i + 1)) {
                console.log(`Trying baudRate=${baudRate} parity=${parity} id=${deviceId}`);
                client.setID(deviceId);
                try {
                    const val = await client.readInputRegisters(1, 2)
                    console.log(`Found device at baudRate=${baudRate} parity=${parity} id=${deviceId}:`, val);
                    return
                } catch {
                    // noop
                } finally {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            await client.close();
        }
    }
}

run().catch(console.error);
