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
      url: process.env.BROKER_URL,
      topic: process.env.TOPIC,
    },
    mongodb: {
      collection: process.env.COLLECTION,
      url: process.env.DATABASE,
    },
  },
}
