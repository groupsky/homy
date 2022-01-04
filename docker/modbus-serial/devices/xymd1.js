async function read (client) {
  const val = await client.readInputRegisters(1, 2)

  // Temperature in Celsius
  const t = val.data[0] / 10
  // Relative humidity
  const h = val.data[1] / 10

  return { t, h }
}

module.exports = {
  read
}
