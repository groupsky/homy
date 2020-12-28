const {Point} = require('@influxdata/influxdb-client')

module.exports = function dds519mr(input) {
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
            .floatField('total', input.tot)
    ]
}
