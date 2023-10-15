// Huawei SUN2000 Inverter

const readLong = (msb, lsb) => msb << 16 | lsb

async function read (client) {
  let data

  data = await client.readHoldingRegisters(32106, 2);
  // Accumulated energy yield (kWh) * 100
  const total_p = readLong(data.data[0], data.data[1]) / 100

  data = await client.readHoldingRegisters(32114, 2);
  // Daily energy yield (kWh) * 100
  const daily_p = readLong(data.data[0], data.data[1]) / 100

  data = await client.readHoldingRegisters(32080, 9)
  // Active power (kW) * 1000
  const ap = readLong(data.data[0], data.data[1]) / 1000
  // Reactive power (kVar) * 1000
  const rp = readLong(data.data[2], data.data[3]) / 1000
  // Power factor (1) * 1000
  const pf = data.data[4] / 1000
  // Grid frequency (Hz) * 100
  const freq = data.data[5] / 100
  // Efficiency (%) * 100
  const eff = data.data[6] / 100
  // Internal temperature (°C) * 10
  const temp = data.data[7] / 10
  // Insulation resistance (MΩ) * 1000
  const ins = data.data[8] / 1000

  return {
    total_p,
    daily_p,
    ap,
    rp,
    pf,
    freq,
    eff,
    temp,
    ins,
  }
}

module.exports = {
  read
}
