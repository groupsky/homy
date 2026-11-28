const {describe, expect, it} = require('@jest/globals')
const ieee754 = require('ieee754')
const {read} = require('./sdm630')

// A client whose input registers 0..79 hold float32 values at the given
// register addresses and zeros elsewhere. Other reads answer with zeros.
const clientWith = (floats) => {
  const buffer = Buffer.alloc(80 * 2)
  for (const [address, value] of Object.entries(floats)) {
    ieee754.write(buffer, value, Number(address) * 2, false, 23, 4)
  }
  return {
    readInputRegisters: async (start, length) =>
      ({data: new Array(length).fill(0), buffer: start === 0 ? buffer : Buffer.alloc(length * 2)}),
  }
}

describe('read', () => {
  it('reads the average line current at 0x2E, where the V1.8 table has it', async () => {
    const result = await read(clientWith({0x2E: 2.5}))
    expect(result.average_c).toBeCloseTo(2.5)
  })

  it('does not read the average line current at 0x2C, which the meter leaves at 0', async () => {
    const result = await read(clientWith({0x2C: 7}))
    expect(result.average_c).toBe(0)
  })
})
