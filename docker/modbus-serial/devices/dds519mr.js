const ieee754 = require('ieee754')

async function read (client) {
  const valInputs1 = await client.readInputRegisters(0x00, 0x14)
  const v = ieee754.read(valInputs1.buffer, 0x00 << 1, false, 23, 4)
  const c = ieee754.read(valInputs1.buffer, 0x08 << 1, false, 23, 4)
  const p = ieee754.read(valInputs1.buffer, 0x12 << 1, false, 23, 4)

  const valInputs2 = await client.readInputRegisters(0x2A, 0x0E)
  const pf = ieee754.read(valInputs2.buffer, (0x2A - 0x2A) << 1, false, 23, 4)
  const freq = ieee754.read(valInputs2.buffer, (0x36 - 0x2A) << 1, false, 23, 4)

  const valInputs3 = await client.readInputRegisters(0x100, 2)
  const tot = ieee754.read(valInputs3.buffer, 0, false, 23, 4)

  return {
    v, c, p, pf, freq, tot
  }
}

module.exports = {
  read
}
