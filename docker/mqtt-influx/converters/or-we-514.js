const {Point} = require('@influxdata/influxdb-client')

// current_power.p is the real (active) power in W. On the OR-WE-514, `ap` is
// apparent power in VA (#1749).
module.exports = function orWe514(input) {
    return [
        new Point('current_power')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .timestamp(input._tz)
            .floatField('v', input.v)
            .floatField('c', input.c)
            .floatField('p', input.p),

        new Point('power_meter')
            .tag('device.name', input.device)
            .tag('device.type', input._type)
            .tag('device.addr', input._addr)
            .timestamp(input._tz)
            .floatField('total', input.tot_act)
    ]
}
