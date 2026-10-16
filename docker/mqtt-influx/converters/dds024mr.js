const {Point} = require('@influxdata/influxdb-client')

// On the DDS024MR, a_ap/b_ap/c_ap are active power in W, so they go into
// current_power.p as they are. (On the SDM630 the same names are VA, #1749.)
module.exports = function dds024mr(input) {
    return [
        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .tag('phase', 'A')
            .timestamp(input._tz)
            .floatField('v', input.av)
            .floatField('c', input.ac)
            .floatField('p', input.a_ap),

        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .tag('phase', 'B')
            .timestamp(input._tz)
            .floatField('v', input.bv)
            .floatField('c', input.bc)
            .floatField('p', input.b_ap),

        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .tag('phase', 'C')
            .timestamp(input._tz)
            .floatField('v', input.cv)
            .floatField('c', input.cc)
            .floatField('p', input.c_ap),

        new Point('power_meter')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .timestamp(input._tz)
            .floatField('total', input.tot_act)
    ]
}
