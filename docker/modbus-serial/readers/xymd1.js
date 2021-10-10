module.exports = async function xymd1 (client) {
  const val = await client.readInputRegisters(1, 2)

  // Temperature in Celsius
  const t = val.data[0] * 0.1
  // Relative humidity
  const h = val.data[1] * 0.1

  return { t, h }
}
