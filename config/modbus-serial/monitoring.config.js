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
  port: '/dev/serial/by-path/pci-0000:00:1d.0-usb-0:1.6:1.0-port0',
  baudRate: 9600,
  parity: 'none',
  msDelayBetweenDevices: 1000,
  devices: [
    {
      name: 'controlbox',
      address: 51,
      reader: 'xymd1',
    },
    {
      name: 'thermostat-martin',
      address: 0x41,
      reader: 'bac002',
    },
    {
      name: 'thermostat-gergana',
      address: 0x42,
      reader: 'bac002',
    },
    {
      name: 'thermostat-boris',
      address: 0x43,
      reader: 'bac002',
    },
    {
      name: 'thermostat-bedroom',
      address: 0x44,
      reader: 'bac002',
    },
  ],
  writers: {
    console: {},
    mqtt: {
      url: process.env.BROKER,
      topic: process.env.TOPIC,
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
