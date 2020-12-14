module.exports = {
  port: '/dev/ttyUSB1',
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
      url: process.env.DATABASE,
    },
  },
}
