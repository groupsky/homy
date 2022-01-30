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
    port: '/dev/serial/by-path/pci-0000:00:1a.0-usb-0:1.5:1.0-port0',
    portConfig: {
      baudRate: 115200,
      parity: 'even',
    },
    msDelayBetweenDevices: 5,
    msTimeout: 50,
  },
  devices: [
    {
      name: 'relays00-15',
      address: 1,
      type: 'aspar-mod-16ro',
      options: {
        maxMsBetweenReports: 7 * 60 * 1000, // 7 minutes
      }
    },
    {
      name: 'relays16-31',
      address: 2,
      type: 'aspar-mod-16ro',
      options: {
        maxMsBetweenReports: 11 * 60 * 1000, // 11 minutes
      }
    },
    {
      name: 'mbsl32di1',
      address: 31,
      type: 'mbsl32di',
      options: {
        maxMsBetweenReports: 5 * 60 * 1000, // 5 minutes
      }
    },
    {
      name: 'mbsl32di2',
      address: 32,
      type: 'mbsl32di',
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
        },
      },
    },
  },
}
