// ORNO OR-WE-516 - 3-phase energy meter with RS-485, 80A, MID, 3 modules, DIN TH-35mm
// https://orno.pl/en/product/1086/3-phase-energy-meter-with-rs-485-80a-mid-3-modules-din-th-35mm

const ieee754 = require('ieee754')

const r = (val, offset) => ieee754.read(val.buffer, offset << 1, false, 23, 4)

async function read (client) {
  const val = await client.readHoldingRegisters(0, 0x43)

  const serialNumber = val.data[0]
  const address = val.data[2]
  const baudRate = val.data[3]
  const softwareVersion = r(val, 4)
  const hardwareVersion = r(val, 6)
  const ctRate = val.data[8]
  const s0OutputRate = r(val, 9)
  const a3 = val.data[11]
  const cycleTime = val.data[13]
  const av = r(val, 14)
  const bv = r(val, 16)
  const cv = r(val, 18)
  const gridFrequency = r(val, 20)
  const ac = r(val, 22)
  const bc = r(val, 24)
  const cc = r(val, 26)
  const totalActivePower = r(val, 28)
  const ap = r(val, 30)
  const bp = r(val, 32)
  const cp = r(val, 34)
  const totalReactivePower = r(val, 36)
  const arp = r(val, 38)
  const brp = r(val, 40)
  const crp = r(val, 42)
  const totalApparentPower = r(val, 44)
  const aap = r(val, 46)
  const bap = r(val, 48)
  const cap = r(val, 50)
  const totalPowerFactor = r(val, 52)
  const apf = r(val, 54)
  const bpf = r(val, 56)
  const cpf = r(val, 58)

  const val2 = await client.readHoldingRegisters(0x100, 0x30)
  const totalActiveEnergy = r(val2, 0)
  const aTotalActiveEnergy = r(val2, 2)
  const bTotalActiveEnergy = r(val2, 4)
  const cTotalActiveEnergy = r(val2, 6)
  const forwardActiveEnergy = r(val2, 8)
  const aForwardActiveEnergy = r(val2, 10)
  const bForwardActiveEnergy = r(val2, 12)
  const cForwardActiveEnergy = r(val2, 14)
  const reverseActiveEnergy = r(val2, 16)
  const aReverseActiveEnergy = r(val2, 18)
  const bReverseActiveEnergy = r(val2, 20)
  const cReverseActiveEnergy = r(val2, 22)
  const totalReactiveEnergy = r(val2, 24)
  const aTotalReactiveEnergy = r(val2, 26)
  const bTotalReactiveEnergy = r(val2, 28)
  const cTotalReactiveEnergy = r(val2, 30)
  const forwardReactiveEnergy = r(val2, 32)
  const aForwardReactiveEnergy = r(val2, 34)
  const bForwardReactiveEnergy = r(val2, 36)
  const cForwardReactiveEnergy = r(val2, 38)
  const reverseReactiveEnergy = r(val2, 40)
  const aReverseReactiveEnergy = r(val2, 42)
  const bReverseReactiveEnergy = r(val2, 44)
  const cReverseReactiveEnergy = r(val2, 46)

  return {
    serialNumber,
    address,
    baudRate,
    softwareVersion,
    hardwareVersion,
    ctRate,
    s0OutputRate,
    a3,
    cycleTime,
    av, bv, cv,
    gridFrequency,
    ac, bc, cc,
    totalActivePower,
    ap, bp, cp,
    totalReactivePower,
    arp, brp, crp,
    totalApparentPower,
    aap, bap, cap,
    totalPowerFactor,
    apf, bpf, cpf,
    totalActiveEnergy,
    aTotalActiveEnergy,
    bTotalActiveEnergy,
    cTotalActiveEnergy,
    forwardActiveEnergy,
    aForwardActiveEnergy,
    bForwardActiveEnergy,
    cForwardActiveEnergy,
    reverseActiveEnergy,
    aReverseActiveEnergy,
    bReverseActiveEnergy,
    cReverseActiveEnergy,
    totalReactiveEnergy,
    aTotalReactiveEnergy,
    bTotalReactiveEnergy,
    cTotalReactiveEnergy,
    forwardReactiveEnergy,
    aForwardReactiveEnergy,
    bForwardReactiveEnergy,
    cForwardReactiveEnergy,
    reverseReactiveEnergy,
    aReverseReactiveEnergy,
    bReverseReactiveEnergy,
    cReverseReactiveEnergy,
  }
}

module.exports = {
  read,
  setup: async function (client, config) {
    const report = {}
    if (config.address) {
      report.address = await client.writeRegister(2, config.address)
    }
    if (config.baudRate) {
      report.address = await client.writeRegister(3, config.baudRate)
    }
    return report
  }
}
