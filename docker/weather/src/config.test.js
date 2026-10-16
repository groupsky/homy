const {loadConfig} = require('./config')

const files = {
    '/run/secrets/user': 'writer\n',
    '/run/secrets/password': 'secret\n',
    '/run/secrets/read_user': 'reader\n',
    '/run/secrets/read_password': 'readsecret\n',
}
const readFile = (path) => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`)
    return files[path]
}
const env = {
    WEATHER_LATITUDE: '12.345',
    WEATHER_LONGITUDE: '23.456',
    INFLUXDB_URL: 'http://influxdb:8086',
    INFLUXDB_DATABASE: 'homy',
    INFLUXDB_USERNAME_FILE: '/run/secrets/user',
    INFLUXDB_PASSWORD_FILE: '/run/secrets/password',
    INFLUXDB_READ_USERNAME_FILE: '/run/secrets/read_user',
    INFLUXDB_READ_PASSWORD_FILE: '/run/secrets/read_password',
}

describe('loadConfig', () => {
    test('reads the location and the InfluxDB settings', () => {
        expect(loadConfig(env, readFile)).toEqual({
            location: {latitude: '12.35', longitude: '23.46'},
            influx: {url: 'http://influxdb:8086', token: 'writer:secret', org: '', bucket: 'homy/autogen'},
            reader: {url: 'http://influxdb:8086', database: 'homy', username: 'reader', password: 'readsecret'},
        })
    })

    test('accepts the credentials directly and a retention policy', () => {
        const direct = {...env, INFLUXDB_USERNAME: 'u', INFLUXDB_PASSWORD: 'p', INFLUXDB_RP: 'weekly'}
        delete direct.INFLUXDB_USERNAME_FILE
        delete direct.INFLUXDB_PASSWORD_FILE
        expect(loadConfig(direct, readFile).influx).toMatchObject({token: 'u:p', bucket: 'homy/weekly'})
    })

    test.each(['WEATHER_LATITUDE', 'WEATHER_LONGITUDE', 'INFLUXDB_URL', 'INFLUXDB_DATABASE', 'INFLUXDB_USERNAME_FILE', 'INFLUXDB_READ_USERNAME_FILE'])(
        'fails when %s is missing',
        (name) => {
            const partial = {...env}
            delete partial[name]
            expect(() => loadConfig(partial, readFile)).toThrow()
        })

    test('the error for a bad location does not repeat the value', () => {
        expect(() => loadConfig({...env, WEATHER_LATITUDE: '99.123'}, readFile)).toThrow(/^(?!.*99\.123)/)
    })
})
