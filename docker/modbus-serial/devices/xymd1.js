// Default configuration for XY-MD1 device:
// address: 1
// baudRate: 9600
// parity: even
// stopBits: 1
// dataBits: 8

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @return {Promise<{t: number, h: number}>}
 */
async function read (client) {
  const val = await client.readInputRegisters(1, 2)

  // Temperature in Celsius
  const t = val.data[0] / 10
  // Relative humidity
  const h = val.data[1] / 10

  return { t, h }
}

/**
 * Setup communication parameters - changes are applied after device restart
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   [address]: number,
 *   [baudRate]: number,
 * }} newConfig
 * @return {Promise<void>}
 */
async function setup (client, newConfig) {
  if (newConfig.address != null) {
    await client.writeRegisters(0x101, [newConfig.address])
    client.setID(newConfig.address)
  }
  if (newConfig.baudRate != null) {
    await client.writeRegisters(0x102, [newConfig.baudRate])
  }
}


module.exports = {
  read,
  setup
}
