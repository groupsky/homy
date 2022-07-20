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
    port: '/dev/serial/by-path/pci-0000:00:14.0-usb-0:2:1.0-port0',
    portConfig: {
      baudRate: 9600,
      parity: 'none',
    },
    msDelayBetweenDevices: 1000,
  },
  devices: [
    {
      name: 'solar_heater',
      address: 0x01,
      type: 'microsyst-sr04',
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
    influxdb: {
      url: process.env.INFLUXDB_URL,
      username: getFileEnv('INFLUXDB_USERNAME'),
      password: getFileEnv('INFLUXDB_PASSWORD'),
      database: process.env.INFLUXDB_DATABASE,
      tags: process.env.INFLUXDB_TAGS ? JSON.parse(process.env.INFLUXDB_TAGS) : [],
      measurement: process.env.INFLUXDB_MEASUREMENT
    }
  },
}
