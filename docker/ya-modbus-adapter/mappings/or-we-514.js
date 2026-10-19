// Field of the old reading (docker/modbus-serial/devices/or-we-514.js) → data
// point id of @ya-modbus/driver-or-we-514. Same holding register, scale and
// unit for each pair: Hz, V, A, W, var, VA, power factor, kWh, kvarh. The
// order is the old reader's, so the JSON text of a reading is the same too.
// The driver reads the power factor as signed and the old reader as
// unsigned; that differs only for a negative one, which the microwave on
// `secondary` did not report (2026-10-18: 0 to 0.998).
module.exports = {
  freq: 'frequency',
  v: 'voltage',
  c: 'current',
  p: 'active_power',
  rp: 'reactive_power',
  ap: 'apparent_power',
  pow: 'power_factor',
  tot_act: 'total_active_energy',
  tot_react: 'total_reactive_energy',
}
