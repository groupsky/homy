const {toInfluxPoint} = require('./influx')

describe('toInfluxPoint', () => {
    test('writes values as floats, integers as integers, at second precision', () => {
        const point = toInfluxPoint({
            measurement: 'weather',
            tags: {source: 'open-meteo', kind: 'forecast', model: 'best_match', lead_hours: '3'},
            fields: {temperature: 7, cloud_cover: 100},
            integers: {issued: 1792130400},
            time: 1792141200,
        })
        expect(point.toLineProtocol()).toBe(
            'weather,kind=forecast,lead_hours=3,model=best_match,source=open-meteo ' +
            'cloud_cover=100,issued=1792130400i,temperature=7 1792141200')
    })
})

test('writes booleans and strings too', () => {
    const point = toInfluxPoint({
        measurement: 'weather',
        tags: {source: 'collector', kind: 'estimate'},
        fields: {temperature: 1.5},
        integers: {},
        booleans: {valid: false},
        strings: {reason: 'pump_on'},
        time: 1705345200,
    })
    expect(point.toLineProtocol()).toBe(
        'weather,kind=estimate,source=collector reason="pump_on",temperature=1.5,valid=F 1705345200')
})

describe('createWriter', () => {
    const http = require('http')
    const {createWriter} = require('./influx')
    let server
    let requests
    let status

    beforeEach(async () => {
        requests = []
        status = 204
        server = http.createServer((req, res) => {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', () => {
                requests.push({url: req.url, auth: req.headers.authorization, body})
                res.writeHead(status, {'content-type': 'application/json'})
                res.end(status === 204 ? '' : JSON.stringify({error: 'boom'}))
            })
        })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    })

    afterEach(async () => {
        await new Promise(resolve => server.close(resolve))
    })

    const sample = {
        measurement: 'weather',
        tags: {source: 'open-meteo', kind: 'current', model: 'best_match'},
        fields: {temperature: 7.5},
        integers: {},
        time: 1792129500,
    }

    function writer() {
        const {port} = server.address()
        return createWriter({url: `http://127.0.0.1:${port}`, token: 'u:p', org: '', bucket: 'homy/autogen'})
    }

    test('sends the points to the InfluxDB 1.x database with second precision', async () => {
        const w = writer()
        await w.writePoints([sample])
        await w.close()
        expect(requests).toHaveLength(1)
        expect(requests[0].url).toContain('bucket=homy%2Fautogen')
        expect(requests[0].url).toContain('precision=s')
        expect(requests[0].auth).toBe('Token u:p')
        expect(requests[0].body).toBe('weather,kind=current,model=best_match,source=open-meteo temperature=7.5 1792129500')
    })

    test('rejects when InfluxDB refuses the write, and sends nothing for an empty list', async () => {
        const w = writer()
        await w.writePoints([])
        expect(requests).toHaveLength(0)
        status = 500
        await expect(w.writePoints([sample])).rejects.toThrow()
        expect(requests).toHaveLength(1)
        await w.close()
    })
})
