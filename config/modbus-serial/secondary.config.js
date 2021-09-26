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
  port: '/dev/serial/by-path/pci-0000:00:1a.0-usb-0:1.4:1.0-port0',
  baudRate: 9600,
  parity: 'even',
  devices: [
    {
      name: 'water_pump',
      address: 0x01,
      reader: 'ex9em',
    },
    {
      name: 'waste_pump',
      address: 0x03,
      reader: 'ex9em',
    },
    {
      name: 'oven',
      address: 0x04,
      reader: 'dds519mr',
    },
    {
      name: 'stove',
      address: 0x05,
      reader: 'dds519mr',
    },
    {
      name: 'dishwasher',
      address: 0x06,
      reader: 'dds519mr',
    },
    {
      name: 'kitchen',
      address: 0x07,
      reader: 'dds519mr',
    },
    {
      name: 'laundry',
      address: 0x08,
      reader: 'dds519mr',
    },
    {
      name: 'boiler',
      address: 0x14,
      reader: 'dds519mr',
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
          user: getFileEnv('MONGODB_USERNAME'),
          password: getFileEnv('MONGODB_PASSWORD'),
        }
      }
    },
  },
}
