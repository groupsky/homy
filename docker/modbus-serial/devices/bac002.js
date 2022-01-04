const map = (val, ...mapping) => val in mapping ? mapping[val] : val

const POWER_MAPPING = Object.freeze({
  off: 0,
  on: 1,
})

const FAN_SETTING_MAPPING = Object.freeze({
  auto: 0,
  high: 1,
  mid: 2,
  low: 3,
})

const DEVICE_MODE_MAPPING = Object.freeze({
  cooling: 0,
  heating: 1,
  ventilation: 2,
})

const LOCK_MAPPING = Object.freeze({
  unlock: 0,
  lock: 1
})

const WEEK_DAY_MAPPING = Object.freeze({
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
})

/**
 * @typedef {('cooling'|'heating'|'ventilation')} DeviceMode
 * @typedef {('off'|'low'|'mid'|'high')} FanStatus
 * @typedef {('auto'|'low'|'mid'|'high')} FanSetting
 * @typedef {('lock'|'unlock')} LockStatus
 * @typedef {('off'|'on')} PowerStatus
 * @typedef {('off'|'on')} ValveStatus
 * @typedef {('mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun')} WeekDay
 */

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @returns {Promise<{
 *   mode: DeviceMode,
 *   fan: number,
 *   fanStatus: FanStatus,
 *   targetTemp: number,
 *   fanSetting: FanSetting,
 *   lock: LockStatus,
 *   power: PowerStatus,
 *   currentTemp: number,
 *   valve: number,
 *   valveStatus: ValveStatus,
 *   weekDay: WeekDay,
 *   minutes: number,
 *   hours: number,
 * }>}
 */
const read = async (client) => {
  const val = await client.readHoldingRegisters(0, 11)

  const power = map(val.data[0], 'off', 'on')
  const fanSetting = map(val.data[1], 'auto', 'high', 'mid', 'low')
  const mode = map(val.data[2], 'cooling', 'heating', 'ventilation')
  const targetTemp = val.data[3] * 0.1
  const lock = map(val.data[4], 'unlock', 'lock')
  const hours = val.data[6]
  const minutes = val.data[5]
  const weekDay = map(val.data[7], '??', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
  const currentTemp = val.data[8] * 0.1
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
    fan, valve,
    weekDay, minutes, hours
  }
}

/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @param {{
 *   power: PowerStatus,
 *   fanSetting: FanSetting,
 *   mode: DeviceMode,
 *   targetTemp: number,
 *   lock: LockStatus,
 *   minutes: number,
 *   hours: number,
 *   weekDay: WeekDay
 * }} values
 * @returns {Promise<void>}
 */
const write = async (client, values) => {
  if (values.reg) {
    await client.writeRegister(values.reg.a, values.reg.v)
  }
  if (values.regs) {
    await client.writeRegisters(values.regs.a, values.regs.v)
  }
  if (values.scan) {
    for (let i=0; i<0xffff; i++) {
      try {
        await client.writeRegister(i, 0)
        console.log('Success writing register', i)
      } catch (e) { }
    }
  }

  if (values.power != null) {
    if (!(values.power in POWER_MAPPING)) {
      throw new Error(`Invalid power value "${values.power}". Valid ${Object.keys(POWER_MAPPING).join(', ')}`)
    }
    await client.writeRegister(0, POWER_MAPPING[values.power])
  }

  if (values.fanSetting != null) {
    if (!(values.fanSetting in FAN_SETTING_MAPPING)) {
      throw new Error(`Invalid fanSetting value "${values.fanSetting}". Valid ${Object.keys(FAN_SETTING_MAPPING).join(', ')}`)
    }
    await client.writeRegister(1, FAN_SETTING_MAPPING[values.fanSetting])
  }

  if (values.mode != null) {
    if (!(values.mode in DEVICE_MODE_MAPPING)) {
      throw new Error(`Invalid mode value "${values.mode}". Valid ${Object.keys(DEVICE_MODE_MAPPING).join(', ')}`)
    }
    await client.writeRegister(2, DEVICE_MODE_MAPPING[values.mode])
  }

  if (values.targetTemp != null) {
    const val = Math.round(values.targetTemp * 2) * 5
    if (val < 0 || val > 1000) {
      throw new Error(`Invalid targetTemp value "${values.targetTemp}". Valid 0..100`)
    }
    await client.writeRegister(3, val)
  }

  if (values.lock != null) {
    if (!(values.lock in LOCK_MAPPING)) {
      throw new Error(`Invalid lock value "${values.lock}". Valid ${Object.keys(LOCK_MAPPING).join(', ')}`)
    }
    await client.writeRegister(4, LOCK_MAPPING[values.lock])
  }

  if (values.minutes != null) {
    const val = Math.round(values.minutes)
    if (val < 0 || val > 59) {
      throw new Error(`Invalid minutes value "${values.minutes}". Valid 0..59`)
    }
    await client.writeRegister(5, val)
  }

  if (values.hours != null) {
    const val = Math.round(values.hours)
    if (val < 0 || val > 23) {
      throw new Error(`Invalid hours value "${values.hours}". Valid 0..23`)
    }
    await client.writeRegister(6, val)
  }

  if (values.weekDay != null) {
    if (!(values.weekDay in WEEK_DAY_MAPPING)) {
      throw new Error(`Invalid weekDay value "${values.weekDay}". Valid ${Object.keys(WEEK_DAY_MAPPING).join(', ')}`)
    }
    await client.writeRegister(7, WEEK_DAY_MAPPING[values.weekDay])
  }
}

module.exports = {
  read,
  write
}
