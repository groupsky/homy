module.exports = {
  modbus: {
    port: '/dev/ttyACM0',
    portConfig: {
      baudRate: 9600,
      parity: 'none',
    },
  },
  devices: [
    {
      name: 'test1',
      address: 0x01,
      type: 'aspar-mod-16ro',
    },
    {
      name: 'test2',
      address: 0x02,
      type: 'aspar-mod-16ro',
    },
  ],
  integrations: {
    console: {},
  },
}
