const homeconnect = require('../homeconnect')

// One point as line protocol, without the timestamp.
const line = (points) => points.map((p) => p.toLineProtocol().replace(/ \d+$/, ''))

describe('homeconnect converter', () => {
    const S = 'homeconnect/oven/state'
    const E = 'homeconnect/oven/event'

    it('logs a text state value as a string field', () => {
        expect(line(homeconnect('Inactive', `${S}/bsh_common_status_operationstate`)))
            .toEqual(['oven,device=oven bsh_common_status_operationstate="Inactive"'])
    })

    it('logs True/False as booleans', () => {
        expect(line(homeconnect('True', `${S}/cooking_oven_setting_light_cavity_001_power`)))
            .toEqual(['oven,device=oven cooking_oven_setting_light_cavity_001_power=T'])
        expect(line(homeconnect('False', `${S}/bsh_common_status_remotecontrolactive`)))
            .toEqual(['oven,device=oven bsh_common_status_remotecontrolactive=F'])
    })

    it('logs numbers as floats, from JSON or from text', () => {
        expect(line(homeconnect(170, `${S}/cooking_oven_option_setpointtemperature`)))
            .toEqual(['oven,device=oven cooking_oven_option_setpointtemperature=170'])
        expect(line(homeconnect('27', `${S}/cooking_oven_status_cavity_001_currenttemperature`)))
            .toEqual(['oven,device=oven cooking_oven_status_cavity_001_currenttemperature=27'])
    })

    it('keeps a time of day as text', () => {
        expect(line(homeconnect('00:03:00', `${S}/bsh_common_setting_appliancetime`)))
            .toEqual(['oven,device=oven bsh_common_setting_appliancetime="00:03:00"'])
    })

    it('logs an event as its event_type', () => {
        expect(line(homeconnect({event_type: 'Present'}, `${E}/cooking_oven_event_cavity_001_programfinished`)))
            .toEqual(['oven,device=oven cooking_oven_event_cavity_001_programfinished="Present"'])
    })

    it('drops an event without event_type', () => {
        expect(homeconnect('x', `${E}/cooking_oven_event_cavity_001_programfinished`)).toEqual([])
    })

    it('logs availability', () => {
        expect(line(homeconnect('online', 'homeconnect/oven/LWT')))
            .toEqual(['oven,device=oven availability="online"'])
    })

    describe('privacy: device identity never reaches InfluxDB', () => {
        // Synthetic values; the bridge publishes the real ones under state/.
        it.each([
            ['serialnumber', '000000000000000000'],
            ['mac', '00-00-00-00-00-00'],
            ['ssid', 'example-wifi'],
            ['deviceid', 'BOSCH-EXAMPLE-000000000000'],
        ])('drops state/%s', (key, value) => {
            expect(homeconnect(value, `${S}/${key}`)).toEqual([])
        })

        it('drops the JSON network topics', () => {
            expect(homeconnect({ipAddress: '0.0.0.0'}, `${S}/ipv4`)).toEqual([])
        })
    })

    it('drops other topics', () => {
        expect(homeconnect('online', 'homeconnect/LWT')).toEqual([])
        expect(homeconnect('{}', 'homeconnect/oven/set')).toEqual([])
        expect(homeconnect('x', 'other/oven/state/bsh_common_status_doorstate')).toEqual([])
    })
})
