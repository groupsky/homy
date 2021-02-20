const ieee754 = require('ieee754')

const r = (value, offset) => ieee754.read(value.buffer, offset << 1, false, 23, 4)

module.exports = async function sdm630modbus (client) {
  const in1 = await client.readInputRegisters(0x00, 80)
  // Phase A/B/C line to neutral volts (Volts)
  const av = r(in1, 0x00)
  const bv = r(in1, 0x02)
  const cv = r(in1, 0x04)
  // Phase A/B/C current (Amps)
  const ac = r(in1, 0x06)
  const bc = r(in1, 0x08)
  const cc = r(in1, 0x0A)
  // Phase A/B/C power (Watts)
  const ap = r(in1, 0x0C)
  const bp = r(in1, 0x0E)
  const cp = r(in1, 0x10)
  // Phase A/B/C volt amps (VA)
  const a_ap = r(in1, 0x12)
  const b_ap = r(in1, 0x14)
  const c_ap = r(in1, 0x16)
  // Phase A/B/C reactive power (VAr)
  const a_rp = r(in1, 0x18)
  const b_rp = r(in1, 0x1A)
  const c_rp = r(in1, 0x1C)
  // Phase A/B/C power factor (1)
  const apf = r(in1, 0x1E)
  const bpf = r(in1, 0x20)
  const cpf = r(in1, 0x22)
  // Phase A/B/C phase angle (Degrees)
  const aphangle = r(in1, 0x24)
  const bphangle = r(in1, 0x26)
  const cphangle = r(in1, 0x28)
  // Average line to neutral volts (Volts)
  const average_v = r(in1, 0x2A)
  // Average line current (Amps)
  const average_c = r(in1, 0x2C)
  // Sum of line currents (Amps)
  const sum_c = r(in1, 0x30)
  // Total system power (Watts)
  const total_p = r(in1, 0x34)
  // Total system volt amps (VA)
  const total_va = r(in1, 0x38)
  // Total system VAr (VAr)
  const total_var = r(in1, 0x3C)
  // Total system power factor (1)
  const total_pf = r(in1, 0x3E)
  // Total system phase angle (Degrees)
  const total_phangle = r(in1, 0x42)
  // Frequency of supply voltages (Hz)
  const freq = r(in1, 0x46)
  // Total import kWh (kWh)
  const total_import_kwh = r(in1, 0x48)
  // Total export kWh (kWh)
  const total_export_kwh = r(in1, 0x4A)
  // Total import kVArh (kVArh)
  const total_import_kvarh = r(in1, 0x4C)
  // Total export kVArh (kVArh)
  const total_export_kvarh = r(in1, 0x4E)

  const in2 = await client.readInputRegisters(0x50, 8)
  // Total VAh (kVAh)
  const total_kvah = r(in2, 0x50 - 0x50)
  // Ah (Ah)
  const ah = r(in2, 0x52 - 0x50)
  // Total system power demand (W)
  const total_demand = r(in2, 0x54 - 0x50)
  // Maximum total system power demand (W)
  const max_total_demand = r(in2, 0x56 - 0x50)

  const in3 = await client.readInputRegisters(0x64, 4)
  // Total system VA demand (VA)
  const total_demand_va = r(in3, 0x64 - 0x64)
  // Maximum total system VA demand (VA)
  const max_total_demand_va = r(in3, 0x66 - 0x64)

  const in4 = await client.readInputRegisters(0xC8, 8)
  // Line A to Line B volts (Volts)
  const avb = r(in4, 0xC8 - 0xC8)
  // Line B to Line C volts (Volts)
  const bvc = r(in4, 0xCA - 0xC8)
  // Line C to Line A volts (Volts)
  const cva = r(in4, 0xCC - 0xC8)
  // Average line to line volts (Volts)
  const average_vv = r(in4, 0xCE - 0xC8)

  const in5 = await client.readInputRegisters(0xE0, 46)
  // Neutral current (Amps)
  const nc = r(in5, 0xE0 - 0xE0)
  // Phase A/B/C L/N volts THD (%)
  const av_thd = r(in5, 0xEA - 0xE0)
  const bv_thd = r(in5, 0xEC - 0xE0)
  const cv_thd = r(in5, 0xEE - 0xE0)
  // Phase A/B/C current THD (%)
  const ac_thd = r(in5, 0xF0 - 0xE0)
  const bc_thd = r(in5, 0xF2 - 0xE0)
  const cc_thd = r(in5, 0xF4 - 0xE0)
  // Average line to neutral volts THD (%)
  const average_v_ln_thd = r(in5, 0xF8 - 0xE0)
  // Average line current THD (%)
  const average_c_thd = r(in5, 0xFA - 0xE0)
  // Phase A/B/C current demand (Amps)
  const ac_demand = r(in5, 0x102 - 0xE0)
  const bc_demand = r(in5, 0x104 - 0xE0)
  const cc_demand = r(in5, 0x106 - 0xE0)
  // Maximum phase A/B/C current demand (Amps)
  const max_ac_demand = r(in5, 0x108 - 0xE0)
  const max_bc_demand = r(in5, 0x10A - 0xE0)
  const max_cc_demand = r(in5, 0x10C - 0xE0)

  const in6 = await client.readInputRegisters(0x14E, 48)
  // Line A to line B volts THD (%)
  const avb_thd = r(in6, 0x14E - 0x14E)
  // Line B to line C volts THD (%)
  const bvc_thd = r(in6, 0x150 - 0x14E)
  // Line C to line A volts THD (%)
  const cva_thd = r(in6, 0x152 - 0x14E)
  // Average line to line volts THD (%)
  const average_v_ll_thd = r(in6, 0x154 - 0x14E)
  // Total kwh (kwh)
  const total_kwh = r(in6, 0x156 - 0x14E)
  // Total kvarh (kvarh)
  const total_kvarh = r(in6, 0x158 - 0x14E)
  // L A/B/C import kwh (kwh)
  const a_import_kwh = r(in6, 0x15A - 0x14E)
  const b_import_kwh = r(in6, 0x15C - 0x14E)
  const c_import_kwh = r(in6, 0x15E - 0x14E)
  // L A/B/C export kwh (kwh)
  const a_export_kwh = r(in6, 0x160 - 0x14E)
  const b_export_kwh = r(in6, 0x162 - 0x14E)
  const c_export_kwh = r(in6, 0x164 - 0x14E)
  // L A/B/C total kwh (kwh)
  const a_total_kwh = r(in6, 0x166 - 0x14E)
  const b_total_kwh = r(in6, 0x168 - 0x14E)
  const c_total_kwh = r(in6, 0x16A - 0x14E)
  // L A/B/C import kvarh (kvarh)
  const a_import_kvarh = r(in6, 0x16C - 0x14E)
  const b_import_kvarh = r(in6, 0x16E - 0x14E)
  const c_import_kvarh = r(in6, 0x170 - 0x14E)
  // L A/B/C export kvarh (kvarh)
  const a_export_kvarh = r(in6, 0x172 - 0x14E)
  const b_export_kvarh = r(in6, 0x174 - 0x14E)
  const c_export_kvarh = r(in6, 0x176 - 0x14E)
  // L A/B/C total kvarh (kvarh)
  const a_total_kvarh = r(in6, 0x178 - 0x14E)
  const b_total_kvarh = r(in6, 0x17A - 0x14E)
  const c_total_kvarh = r(in6, 0x17C - 0x14E)

  return {
    // Phase A/B/C line to neutral volts (Volts)
    av,
    bv,
    cv,
    // Phase A/B/C current (Amps)
    ac,
    bc,
    cc,
    // Phase A/B/C power (Watts)
    ap,
    bp,
    cp,
    // Phase A/B/C volt amps (VA)
    a_ap,
    b_ap,
    c_ap,
    // Phase A/B/C reactive power (VAr)
    a_rp,
    b_rp,
    c_rp,
    // Phase A/B/C power factor (1)
    apf,
    bpf,
    cpf,
    // Phase A/B/C phase angle (Degrees)
    aphangle,
    bphangle,
    cphangle,
    // Average line to neutral volts (Volts)
    average_v,
    // Average line current (Amps)
    average_c,
    // Sum of line currents (Amps)
    sum_c,
    // Total system power (Watts)
    total_p,
    // Total system volt amps (VA)
    total_va,
    // Total system VAr (VAr)
    total_var,
    // Total system power factor (1)
    total_pf,
    // Total system phase angle (Degrees)
    total_phangle,
    // Frequency of supply voltages (Hz)
    freq,
    // Total import kWh (kWh)
    total_import_kwh,
    // Total export kWh (kWh)
    total_export_kwh,
    // Total import kVArh (kVArh)
    total_import_kvarh,
    // Total export kVArh (kVArh)
    total_export_kvarh,
    // Total VAh (kVAh)
    total_kvah,
    // Ah (Ah)
    ah,
    // Total system power demand (W)
    total_demand,
    // Maximum total system power demand (W)
    max_total_demand,
    // Total system VA demand (VA)
    total_demand_va,
    // Maximum total system VA demand (VA)
    max_total_demand_va,
    // Line A to Line B volts (Volts)
    avb,
    // Line B to Line C volts (Volts)
    bvc,
    // Line C to Line A volts (Volts)
    cva,
    // Average line to line volts (Volts)
    average_vv,
    // Neutral current (Amps)
    nc,
    // Phase A/B/C L/N volts THD (%)
    av_thd,
    bv_thd,
    cv_thd,
    // Phase A/B/C current THD (%)
    ac_thd,
    bc_thd,
    cc_thd,
    // Average line to neutral volts THD (%)
    average_v_ln_thd,
    // Average line current THD (%)
    average_c_thd,
    // Phase A/B/C current demand (Amps)
    ac_demand,
    bc_demand,
    cc_demand,
    // Maximum phase A/B/C current demand (Amps)
    max_ac_demand,
    max_bc_demand,
    max_cc_demand,
    // Line A to line B volts THD (%)
    avb_thd,
    // Line B to line C volts THD (%)
    bvc_thd,
    // Line C to line A volts THD (%)
    cva_thd,
    // Average line to line volts THD (%)
    average_v_ll_thd,
    // Total kwh (kwh)
    total_kwh,
    // Total kvarh (kvarh)
    total_kvarh,
    // L A/B/C import kwh (kwh)
    a_import_kwh,
    b_import_kwh,
    c_import_kwh,
    // L A/B/C export kwh (kwh)
    a_export_kwh,
    b_export_kwh,
    c_export_kwh,
    // L A/B/C total kwh (kwh)
    a_total_kwh,
    b_total_kwh,
    c_total_kwh,
    // L A/B/C import kvarh (kvarh)
    a_import_kvarh,
    b_import_kvarh,
    c_import_kvarh,
    // L A/B/C export kvarh (kvarh)
    a_export_kvarh,
    b_export_kvarh,
    c_export_kvarh,
    // L A/B/C total kvarh (kvarh)
    a_total_kvarh,
    b_total_kvarh,
    c_total_kvarh,
  }
}
