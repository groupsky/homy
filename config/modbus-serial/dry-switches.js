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
  port: '/dev/ttyUSB3',
  baudRate: 115200,
  parity: 'even',
  devices: [
    {
      name: 'di1',
      address: 0x01,
      reader: 'mbsl32di',
      readerOptions: {
        inputs: {
          0: 'front door left',
          1: 'front door right',
          2: 'window livingroom',
          3: 'window cabinet south',
          4: 'window cabinet west'
        }
      }
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
