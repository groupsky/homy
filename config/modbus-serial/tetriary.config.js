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
  port: '/dev/ttyUSB2',
  baudRate: 9600,
  parity: 'even',
  devices: [
    {
      name: 'heat_pump',
      address: 0x01,
      reader: 'sdm630',
    },
  ],
  writers: {
    console: {},
    // mqtt: {
    //   url: process.env.BROKER,
    //   topic: process.env.TOPIC,
    // },
    // mongodb: {
    //   collection: process.env.COLLECTION,
    //   url: process.env.MONGODB_URL,
    //   options: {
    //     auth: {
    //       user: getFileEnv('MONGODB_USERNAME'),
    //       password: getFileEnv('MONGODB_PASSWORD'),
    //     }
    //   }
    // },
  },
}
