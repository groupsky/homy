module.exports = async function mbsl32di (client, { maxMsBetweenReports = 0 } = {}, state = {}) {
  const val = await client.readHoldingRegisters(0x0000, 2)
  const newFlags = val.data[1] << 16 || val.data[0]

  const noChange = newFlags ^ state.flags === 0
  const recentReport = maxMsBetweenReports === 0 || Date.now() - (state.lastReport || 0) < maxMsBetweenReports
  if (noChange && recentReport) {
    return
  }

  state.lastReport = Date.now()
  state.flags = newFlags

  return { inputs: newFlags }
}
