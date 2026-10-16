const {Point} = require('@influxdata/influxdb-client')

// current_power.p is the real (active) power of each phase in W: ap/bp/cp.
// On the SDM630, a_ap/b_ap/c_ap are apparent power in VA (#1749).
module.exports = function sdm630(input) {
    return [
        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .tag('phase', 'A')
            .timestamp(input._tz)
            .floatField('v', input.av)
            .floatField('c', input.ac)
            .floatField('p', input.ap),

        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .tag('phase', 'B')
            .timestamp(input._tz)
            .floatField('v', input.bv)
            .floatField('c', input.bc)
            .floatField('p', input.bp),

        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .tag('phase', 'C')
            .timestamp(input._tz)
            .floatField('v', input.cv)
            .floatField('c', input.cc)
            .floatField('p', input.cp),

        new Point('power_meter')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .timestamp(input._tz)
            .floatField('total', input.total_kwh),

        new Point('power_meter')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .timestamp(input._tz)
            .floatField('total', input.total_import_kwh),

        new Point('power_meter')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .timestamp(input._tz)
            .floatField('total_export', input.total_export_kwh),
    ]
}
