async function read (client) {
  const val = await client.readHoldingRegisters(0x0000, 0x2C)

  // Voltage in Volts
  const v = val.data[0] / 10
  // Current in Amps
  const c = val.data[1] / 10
  // Grid frequency in Hz
  const freq = val.data[2] / 10
  // Power in W
  const p = val.data[3]
  // Reactive power in VAr
  const rp = val.data[4]
  // Apparent power in VA
  const ap = val.data[5]
  // Power
  const pow = val.data[6] / 1000
  // Total power in kWh
  const tot_act = (val.data[7] * (1 << 16) + val.data[8]) / 100
  // Total reactive in kVArh
  const tot_react = (val.data[9] * (1 << 16) + val.data[10]) / 100

  return { v, c, p, rp, freq, ap, pow, tot_act, tot_react }
}

module.exports = {
  read
}
