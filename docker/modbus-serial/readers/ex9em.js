module.exports = async function ex9em (client) {
  const val = await client.readHoldingRegisters(0x0000, 0x2C)

  // Voltage in Volts
  const v = val.data[0] * 0.1
  // Current in Amps
  const c = val.data[1] * 0.1
  // Grid frequency in Hz
  const freq = val.data[2] * 0.1
  // Power in W
  const p = val.data[3]
  // Reactive power in VAr
  const rp = val.data[4]
  // Apparent power in VA
  const ap = val.data[5]
  // Power
  const pow = val.data[6] * 0.001
  // Total power in kWh
  const tot_act = val.data[8] * 0.01 // val.data[7] has the higher order, but not sure how to sum
  // Total reactive in kVArh
  const tot_react = val.data[10] * 0.01 // ? what divider

  return { v, c, p, rp, freq, ap, pow, tot_act, tot_react }
}
