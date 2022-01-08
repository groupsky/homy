/**
 * @param {import('modbus-serial').ModbusRTU} client
 * @returns {Promise<{
 *   roomSensorFailure: boolean,
 *   pipeSensorFailure: boolean,
 *   highTempWarning: boolean,
 *   lowTempWarning: boolean,
 *   externalWarning: boolean,
 *   tempOutput: boolean,
 *   fanOutput: boolean,
 *   defrostOutput: boolean,
 *   remoteForceDefrost: boolean,
 *   systemOnline: boolean,
 *   defrost: boolean,
 * }>}
 */
const read = async (client) => {
  let val

  const { data: [roomSensorFailure, pipeSensorFailure] } = await client.readCoils(0, 2)
  const { data: [highTempWarning, lowTempWarning, externalWarning] } = await client.readCoils(8, 3)
  const { data: [tempOutput, fanOutput, defrostOutput] } = await client.readCoils(20, 3)
  const { data: [remoteForceDefrost, systemOnline, defrost] } = await client.readCoils(50, 3)

  return {
    roomSensorFailure, pipeSensorFailure,
    highTempWarning, lowTempWarning, externalWarning,
    tempOutput, fanOutput, defrostOutput,
    remoteForceDefrost, systemOnline, defrost,
  }
}

module.exports = {
  read,
}
