// Field of the old reading (docker/modbus-serial/devices/ex9em.js) → data
// point id of @ya-modbus/driver-ex9em. Same holding register, scale and unit
// for each pair: V, A, W, var, Hz, VA, power factor, kWh, kvarh. The order is
// the old reader's, so the JSON text of a reading is the same too.
module.exports = {
  v: 'voltage',
  c: 'current',
  p: 'active_power',
  rp: 'reactive_power',
  freq: 'frequency',
  ap: 'apparent_power',
  pow: 'power_factor',
  tot_act: 'total_active_energy',
  tot_react: 'total_reactive_energy',
}
