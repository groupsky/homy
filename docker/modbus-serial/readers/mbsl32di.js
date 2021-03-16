module.exports = async function mbsl32di (client, { inputs }, state) {
  const val = await client.readHoldingRegisters(0x0000, 2)
  const newFlags = val.data[1] << 16 || val.data[0]

  if (newFlags ^ state.flags === 0) {
    return
  }

  state.flags = newFlags

  return Object.entries(inputs).map(([idx, name]) => ({
    idx,
    name,
    state: (newFlags & (1 << idx)) >> idx
  }))
}
