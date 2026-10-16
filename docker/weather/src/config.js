const {parseLocation} = require('./open-meteo')

// Reads NAME_FILE (a Docker secret) or else NAME.
function readSecret(env, readFile, name) {
    const file = env[`${name}_FILE`]
    if (file) return readFile(file).trim()
    return env[name] || null
}

function required(env, name) {
    if (!env[name]) throw new Error(`${name} is required`)
    return env[name]
}

function loadConfig(env, readFile) {
    const location = parseLocation(env.WEATHER_LATITUDE, env.WEATHER_LONGITUDE)
    const url = required(env, 'INFLUXDB_URL')
    const database = required(env, 'INFLUXDB_DATABASE')
    const username = readSecret(env, readFile, 'INFLUXDB_USERNAME')
    const password = readSecret(env, readFile, 'INFLUXDB_PASSWORD')
    if (!username || !password) {
        throw new Error('InfluxDB credentials are required (INFLUXDB_USERNAME_FILE and INFLUXDB_PASSWORD_FILE)')
    }
    // The read user is for the collector estimate, which reads the solar controller data.
    const readUsername = readSecret(env, readFile, 'INFLUXDB_READ_USERNAME')
    const readPassword = readSecret(env, readFile, 'INFLUXDB_READ_PASSWORD')
    if (!readUsername || !readPassword) {
        throw new Error('InfluxDB read credentials are required (INFLUXDB_READ_USERNAME_FILE and INFLUXDB_READ_PASSWORD_FILE)')
    }
    return {
        location,
        influx: {
            url,
            // InfluxDB 1.x through the 2.x client: token "user:password", bucket "db/rp".
            token: `${username}:${password}`,
            org: '',
            bucket: `${database}/${env.INFLUXDB_RP || 'autogen'}`,
        },
        reader: {url, database, token: `${readUsername}:${readPassword}`},
    }
}

module.exports = {loadConfig}
