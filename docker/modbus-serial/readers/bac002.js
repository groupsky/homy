const map = (val, ...mapping) => val in mapping ? mapping[val] : val

module.exports = async function bac002 (client) {
  const val = await client.readHoldingRegisters(0, 11)

  const power = map(val.data[0], 'off', 'on')
  const fanSetting = map(val.data[1], 'auto', 'high', 'mid', 'low')
  const mode = map(val.data[2], 'cooling', 'heating', 'ventilation')
  const targetTemp = val.data[3] * 0.1
  const lock = map(val.data[4], 'unlock', 'lock')
  const time = `${`0${val.data[6]}`.substr(-2)}:${`0${val.data[5]}`.substr(-2)}`
  const weekDay = map(val.data[7], '??', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')
  const currentTemp = val.data[8]*0.1
  const valve = val.data[9]
  const valveStatus = map(valve, 'off', 'on')
  const fan = val.data[10]
  const fanStatus = map(fan, 'off', 'high', 'mid', 'low')
  return {
    power,
    fanSetting, fanStatus,
    mode, valveStatus,
    targetTemp, currentTemp,
    lock,
    fan, valve
  }
}
