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
  msDelayBetweenDevices: 0,
  msTimeout: 50,
  devices: [
    {
      name: 'mbsl32di1',
      address: 31,
      reader: 'mbsl32di',
      readerOptions: {
        maxMsBetweenReports: 5 * 60 * 1000, // 5 minutes
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
        },
      },
    },
  },
}
