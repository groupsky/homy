function getFile(filePath) {
    if (filePath) {
        const fs = require('fs');

        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath);
            }
        } catch (err) {
            console.error('Failed to read file', filePath, err);
        }
    }
    return null;
}

function getFileEnv(envVariable) {
    const origVar = process.env[envVariable];
    const fileVar = process.env[envVariable + '_FILE'];
    if (fileVar) {
        const file = getFile(fileVar);
        if (file) {
            return file.toString().split(/\r?\n/)[0].trim();
        }
    }
    return origVar;
}

module.exports = {
    modbus: {
        type: 'tcp',
        port: '192.168.0.51',
        portConfig: {
            port: 502,
        },
        msDelayBetweenDevices: 5000,
    },
    devices: [
        {
            name: 'inverter',
            address: 0x01,
            type: 'sun2000',
            options: {
                maxMsBetweenReports: 5 * 60 * 1000, // 5 minutes
            }
        },
    ],
    integrations: {
        console: {},
        mqtt: {
            url: process.env.BROKER,
            publishTopic: process.env.TOPIC,
        },
        mongodb: {
            collection: process.env.COLLECTION,
            url: process.env.MONGODB_URL,
            options: {
                auth: {
                    username: getFileEnv('MONGODB_USERNAME'),
                    password: getFileEnv('MONGODB_PASSWORD'),
                }
            }
        },
    },
}
