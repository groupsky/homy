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
    port: '/dev/serial/by-path/pci-0000:00:14.0-usb-0:1:1.0-port0',
    portConfig: {
      baudRate: 9600,
      parity: 'odd',
    },
    msDelayBetweenDevices: 50,
  },
  devices: [
    {
      name: 'heatpump-ctrl',
      address: 50,
      type: 'autonics-tf3',
      options: {
        maxMsBetweenReports: 5 * 60 * 1000, // 5 minutes
      }
    },
    {
      name: 'stab-em',
      address: 77,
      type: 'or-we-516',
    },
  ],
  integrations: {
    console: {},
    mqtt: {
      url: process.env.BROKER,
      publishTopic: process.env.TOPIC,
      subscribeTopic: process.env.SUBSCRIBE_TOPIC,
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
