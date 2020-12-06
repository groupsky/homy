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
}
