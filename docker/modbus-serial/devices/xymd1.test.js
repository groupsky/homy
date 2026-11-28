const {describe, expect, it} = require('@jest/globals')
const {read} = require('./xymd1')

const clientWith = (data) => ({readInputRegisters: async () => ({data})})

describe('read', () => {
  it('reads a temperature below zero as signed: 0xFF33 is -20.5', async () => {
    expect(await read(clientWith([0xFF33, 655]))).toEqual({t: -20.5, h: 65.5})
  })

  it('reads a temperature above zero as before', async () => {
    expect(await read(clientWith([0x00FB, 400]))).toEqual({t: 25.1, h: 40})
  })
})
