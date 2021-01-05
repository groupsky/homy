function getFile(filePath) {
  if (typeof filePath !== 'undefined' && filePath) {
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
  port: '/dev/ttyUSB0',
  baudRate: 9600,
  parity: 'even',
  devices: [
    {
      name: 'main',
      address: 0x01,
      reader: 'dds024mr',
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
