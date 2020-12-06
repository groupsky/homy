const ieee754 = require('ieee754')

module.exports = async function dds024mr (client) {
  let val

  val = await client.readInputRegisters(0x00, 0x38)
  const av = ieee754.read(val.buffer, 0x00 << 1, false, 23, 4)
  const bv = ieee754.read(val.buffer, 0x02 << 1, false, 23, 4)
  const cv = ieee754.read(val.buffer, 0x04 << 1, false, 23, 4)
  const ac = ieee754.read(val.buffer, 0x08 << 1, false, 23, 4)
  const bc = ieee754.read(val.buffer, 0x0A << 1, false, 23, 4)
  const cc = ieee754.read(val.buffer, 0x0C << 1, false, 23, 4)
  const sum_ap = ieee754.read(val.buffer, 0x10 << 1, false, 23, 4)
  const a_ap = ieee754.read(val.buffer, 0x12 << 1, false, 23, 4)
  const b_ap = ieee754.read(val.buffer, 0x14 << 1, false, 23, 4)
  const c_ap = ieee754.read(val.buffer, 0x16 << 1, false, 23, 4)
  const sum_rp = ieee754.read(val.buffer, 0x18 << 1, false, 23, 4)
  const a_rp = ieee754.read(val.buffer, 0x1A << 1, false, 23, 4)
  const b_rp = ieee754.read(val.buffer, 0x1C << 1, false, 23, 4)
  const c_rp = ieee754.read(val.buffer, 0x1E << 1, false, 23, 4)
  const apf = ieee754.read(val.buffer, 0x2A << 1, false, 23, 4)
  const bpf = ieee754.read(val.buffer, 0x2C << 1, false, 23, 4)
  const cpf = ieee754.read(val.buffer, 0x2E << 1, false, 23, 4)
  const freq = ieee754.read(val.buffer, 0x36 << 1, false, 23, 4)

  val = await client.readInputRegisters(0x100, 2)
  const tot_act = ieee754.read(val.buffer, 0x00, false, 23, 4)

  val = await client.readInputRegisters(0x400, 2)
  const tot_react = ieee754.read(val.buffer, 0x00, false, 23, 4)

  return {
    av, bv, cv, ac, bc, cc,
    sum_ap, a_ap, b_ap, c_ap,
    sum_rp, a_rp, b_rp, c_rp,
    apf, bpf, cpf, freq,
    tot_act, tot_react,
  }
}
