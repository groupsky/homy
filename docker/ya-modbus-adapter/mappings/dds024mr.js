// Field of the old reading (docker/modbus-serial/devices/dds024mr.js) →
// data point id of @ya-modbus/driver-dds024mr. Same register and unit for
// each pair: V, A, W, var, Hz, kWh, kvarh. The order is the old reader's, so
// the JSON text of a reading is the same too.
module.exports = {
  av: 'voltage_l1',
  bv: 'voltage_l2',
  cv: 'voltage_l3',
  ac: 'current_l1',
  bc: 'current_l2',
  cc: 'current_l3',
  sum_ap: 'active_power_total',
  a_ap: 'active_power_l1',
  b_ap: 'active_power_l2',
  c_ap: 'active_power_l3',
  sum_rp: 'reactive_power_total',
  a_rp: 'reactive_power_l1',
  b_rp: 'reactive_power_l2',
  c_rp: 'reactive_power_l3',
  apf: 'power_factor_l1',
  bpf: 'power_factor_l2',
  cpf: 'power_factor_l3',
  freq: 'frequency',
  tot_act: 'active_energy_total',
  tot_react: 'reactive_energy_total',
}
