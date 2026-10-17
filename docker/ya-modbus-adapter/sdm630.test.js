const {describe, expect, it} = require('@jest/globals')
const {devicesFromBridgeConfig, toReading} = require('./adapter')

// A real reading of the old reader (modbus-serial, devices/sdm630.js) on the
// main bus, as one line of its NDJSON day file, 2026-10-15.
const OLD_LINE =
  '{"av":234.1174774169922,"bv":232.86769104003906,"cv":236.7593994140625,"ac":2.6595633029937744,"bc":8.248851776123047,' +
  '"cc":0.8183291554450989,"ap":564.1803588867188,"bp":1916.525146484375,"cp":27.846731185913086,"a_ap":622.6502685546875,' +
  '"b_ap":1920.8909912109375,"c_ap":193.7471160888672,"a_rp":-263.4272155761719,"b_rp":-129.43724060058594,"c_rp":-191.7355194091797,' +
  '"apf":0.906095027923584,"bpf":0.99772709608078,"cpf":0.14372718334197998,"aphangle":-25.030672073364258,"bphangle":-3.8640472888946533,' +
  '"cphangle":-81.74243927001953,"average_v":234.58152770996094,"average_c":0,"sum_c":11.726743698120117,"total_p":2508.55224609375,' +
  '"total_va":2576.538818359375,"total_var":-586.2044067382812,"total_pf":0.9738022089004517,"total_phangle":-13.144820213317871,"freq":49.91885757446289,' +
  '"total_import_kwh":50658.73046875,"total_export_kwh":390.843994140625,"total_import_kvarh":8321.326171875,"total_export_kvarh":11247.322265625,"total_kvah":54671.6640625,' +
  '"ah":138805.765625,"total_demand":1154.6685791015625,"max_total_demand":8631.482421875,"total_demand_va":1316.9302978515625,"max_total_demand_va":8690.107421875,' +
  '"avb":404.4549865722656,"bvc":406.6795654296875,"cva":407.7315368652344,"average_vv":406.3513488769531,"nc":6.6935200691223145,' +
  '"av_thd":4.248082637786865,"bv_thd":4.397828578948975,"cv_thd":4.798747539520264,"ac_thd":40.741390228271484,"bc_thd":4.569319725036621,' +
  '"cc_thd":20.16480255126953,"average_v_ln_thd":4.481553077697754,"average_c_thd":21.464683532714844,"ac_demand":2.293990135192871,"bc_demand":2.3639028072357178,' +
  '"cc_demand":1.2708247900009155,"max_ac_demand":22.50074577331543,"max_bc_demand":19.597503662109375,"max_cc_demand":14.785612106323242,"avb_thd":0,' +
  '"bvc_thd":0,"cva_thd":0,"average_v_ll_thd":0,"total_kwh":51049.57421875,"total_kvarh":19568.6484375,' +
  '"a_import_kwh":22163.89453125,"b_import_kwh":16848.4609375,"c_import_kwh":11646.376953125,"a_export_kwh":21.11699867248535,"b_export_kwh":215.43099975585938,' +
  '"c_export_kwh":154.29598999023438,"a_total_kwh":22185.01171875,"b_total_kwh":17063.890625,"c_total_kwh":11800.6728515625,"a_import_kvarh":3300.5419921875,' +
  '"b_import_kvarh":2596.41796875,"c_import_kvarh":2424.366943359375,"a_export_kvarh":3164.263916015625,"b_export_kvarh":4429.32373046875,"c_export_kvarh":3653.73486328125,' +
  '"a_total_kvarh":6464.8056640625,"b_total_kvarh":7025.74169921875,"c_total_kvarh":6078.1015625,"_tz":1792084166587,"_ms":742,' +
  '"_addr":1,"_type":"sdm630","device":"main"}'

// The same values as @ya-modbus/driver-sdm630 publishes them, by register.
// The old reader reads `average_c` at 0x2C, a register the manual does not
// have (always 0). The driver reads the average line current at 0x2E
// (`current_average`); this value is the mean of the three phase currents.
const CURRENT_AVERAGE = 3.908914804458618
const MESSAGE = {
  deviceId: 'main',
  timestamp: 1792084166587,
  data: {
    voltage_l1: 234.1174774169922,
    voltage_l2: 232.86769104003906,
    voltage_l3: 236.7593994140625,
    current_l1: 2.6595633029937744,
    current_l2: 8.248851776123047,
    current_l3: 0.8183291554450989,
    active_power_l1: 564.1803588867188,
    active_power_l2: 1916.525146484375,
    active_power_l3: 27.846731185913086,
    apparent_power_l1: 622.6502685546875,
    apparent_power_l2: 1920.8909912109375,
    apparent_power_l3: 193.7471160888672,
    reactive_power_l1: -263.4272155761719,
    reactive_power_l2: -129.43724060058594,
    reactive_power_l3: -191.7355194091797,
    power_factor_l1: 0.906095027923584,
    power_factor_l2: 0.99772709608078,
    power_factor_l3: 0.14372718334197998,
    phase_angle_l1: -25.030672073364258,
    phase_angle_l2: -3.8640472888946533,
    phase_angle_l3: -81.74243927001953,
    voltage_ln_average: 234.58152770996094,
    current_average: CURRENT_AVERAGE,
    current_sum: 11.726743698120117,
    active_power_total: 2508.55224609375,
    apparent_power_total: 2576.538818359375,
    reactive_power_total: -586.2044067382812,
    power_factor_total: 0.9738022089004517,
    phase_angle_total: -13.144820213317871,
    frequency: 49.91885757446289,
    active_energy_forward: 50658.73046875,
    active_energy_reverse: 390.843994140625,
    reactive_energy_forward: 8321.326171875,
    reactive_energy_reverse: 11247.322265625,
    apparent_energy_total: 54671.6640625,
    charge_total: 138805.765625,
    active_power_demand: 1154.6685791015625,
    active_power_demand_max: 8631.482421875,
    apparent_power_demand: 1316.9302978515625,
    apparent_power_demand_max: 8690.107421875,
    voltage_l1_l2: 404.4549865722656,
    voltage_l2_l3: 406.6795654296875,
    voltage_l3_l1: 407.7315368652344,
    voltage_ll_average: 406.3513488769531,
    current_neutral: 6.6935200691223145,
    voltage_thd_l1: 4.248082637786865,
    voltage_thd_l2: 4.397828578948975,
    voltage_thd_l3: 4.798747539520264,
    current_thd_l1: 40.741390228271484,
    current_thd_l2: 4.569319725036621,
    current_thd_l3: 20.16480255126953,
    voltage_thd_ln_average: 4.481553077697754,
    current_thd_average: 21.464683532714844,
    current_demand_l1: 2.293990135192871,
    current_demand_l2: 2.3639028072357178,
    current_demand_l3: 1.2708247900009155,
    current_demand_max_l1: 22.50074577331543,
    current_demand_max_l2: 19.597503662109375,
    current_demand_max_l3: 14.785612106323242,
    voltage_thd_l1_l2: 0,
    voltage_thd_l2_l3: 0,
    voltage_thd_l3_l1: 0,
    voltage_thd_ll_average: 0,
    active_energy_total: 51049.57421875,
    reactive_energy_total: 19568.6484375,
    active_energy_forward_l1: 22163.89453125,
    active_energy_forward_l2: 16848.4609375,
    active_energy_forward_l3: 11646.376953125,
    active_energy_reverse_l1: 21.11699867248535,
    active_energy_reverse_l2: 215.43099975585938,
    active_energy_reverse_l3: 154.29598999023438,
    active_energy_l1: 22185.01171875,
    active_energy_l2: 17063.890625,
    active_energy_l3: 11800.6728515625,
    reactive_energy_forward_l1: 3300.5419921875,
    reactive_energy_forward_l2: 2596.41796875,
    reactive_energy_forward_l3: 2424.366943359375,
    reactive_energy_reverse_l1: 3164.263916015625,
    reactive_energy_reverse_l2: 4429.32373046875,
    reactive_energy_reverse_l3: 3653.73486328125,
    reactive_energy_l1: 6464.8056640625,
    reactive_energy_l2: 7025.74169921875,
    reactive_energy_l3: 6078.1015625,
  },
}

// The old line without `_ms`, and with the real average line current.
const EXPECTED = (() => {
  // eslint-disable-next-line no-unused-vars
  const {_ms, ...rest} = JSON.parse(OLD_LINE)
  return {...rest, average_c: CURRENT_AVERAGE}
})()

const [DEVICE] = devicesFromBridgeConfig({
  topicPrefix: 'ya-modbus',
  devices: [{
    deviceId: 'main',
    driver: '@ya-modbus/driver-sdm630',
    connection: {type: 'rtu', port: '/dev/ttyUSB0', baudRate: 9600, parity: 'none', slaveId: 1},
  }],
})

describe('the sdm630 mapping', () => {
  it('gives the old reading, without _ms and with average_c from current_average', () => {
    const reading = toReading(MESSAGE, DEVICE)

    expect(reading).toStrictEqual(EXPECTED)
    // Same keys in the same order, so the text is the same too.
    expect(JSON.stringify(reading)).toBe(JSON.stringify(EXPECTED))
  })

  it('maps all 83 data points of the driver, each to one old field', () => {
    const ids = Object.values(DEVICE.mapping)

    expect(ids).toHaveLength(83)
    expect(new Set(ids).size).toBe(83)
    expect([...ids].sort()).toStrictEqual(Object.keys(MESSAGE.data).sort())
  })

  // mqtt-influx (converters/sdm630.js) writes `current_power.p` from
  // `ap`/`bp`/`cp`, the active power (W, #1749). On the SDM630 the old
  // `a_ap`/`b_ap`/`c_ap` are the apparent power (VA), not the active power.
  it('takes a_ap, b_ap and c_ap from the apparent power, and ap, bp, cp from the active power', () => {
    const reading = toReading(MESSAGE, DEVICE)

    expect(reading.a_ap).toBe(MESSAGE.data.apparent_power_l1)
    expect(reading.b_ap).toBe(MESSAGE.data.apparent_power_l2)
    expect(reading.c_ap).toBe(MESSAGE.data.apparent_power_l3)
    expect(reading.ap).toBe(MESSAGE.data.active_power_l1)
    expect(reading.bp).toBe(MESSAGE.data.active_power_l2)
    expect(reading.cp).toBe(MESSAGE.data.active_power_l3)
    expect(reading.a_ap).not.toBe(reading.ap)
  })
})
