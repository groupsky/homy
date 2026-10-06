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
        port: 'inverter.srv.net.roupsky.name',
        portConfig: {
            port: 502,
        },
        msDelayBetweenDevices: 15000,
        // A SUN2000 answer takes about 600 ms, sometimes more than 1 s; the
        // default 1000 ms timed out about 2 of 3 polls in daytime (#1368).
        msTimeout: 4000,
    },
    devices: [
        {
            name: 'main',
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
        ndjson: {
            root: process.env.RAW_DIR,
            stream: process.env.COLLECTION,
            service: process.env.SERVICE_NAME,
        },
        influxdb: {
            url: process.env.INFLUXDB_URL,
            username: getFileEnv('INFLUXDB_USERNAME'),
            password: getFileEnv('INFLUXDB_PASSWORD'),
            database: process.env.INFLUXDB_DATABASE,
            tags: process.env.INFLUXDB_TAGS ? JSON.parse(process.env.INFLUXDB_TAGS) : [],
            measurement: process.env.INFLUXDB_MEASUREMENT
        },
    },
}
