// Field of the old reading (docker/modbus-serial/devices/dds519mr.js) → data
// point id of @ya-modbus/driver-dds519mr. Same input register (float32) and
// unit for each pair: V, A, W, power factor, Hz, kWh. The order is the old
// reader's, so the JSON text of a reading is the same too.
module.exports = {
  v: 'voltage',
  c: 'current',
  p: 'active_power',
  pf: 'power_factor',
  freq: 'frequency',
  tot: 'total_active_energy',
}
