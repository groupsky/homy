const http = require('http')
const {createReader} = require('./influx-query')

let server
let reply
let requests

beforeAll(async () => {
    server = http.createServer((req, res) => {
        requests.push({url: req.url, auth: req.headers.authorization})
        reply(req, res)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
})

beforeEach(() => { requests = [] })

afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
})

function reader() {
    return createReader({url: `http://127.0.0.1:${server.address().port}`, database: 'homy', username: 'reader', password: 'secret'})
}

const json = (res, status, body) => res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body))

test('sends InfluxQL to /query with epoch seconds and basic auth, and returns the series', async () => {
    const series = [{name: 'xymd1', columns: ['time', 'mean', 'count'], values: [[1705345200, 1.5, 700]]}]
    reply = (req, res) => json(res, 200, {results: [{statement_id: 0, series}]})
    await expect(reader().query('SELECT mean("t3") FROM "xymd1"')).resolves.toEqual(series)
    const url = new URL(requests[0].url, 'http://x')
    expect(url.pathname).toBe('/query')
    expect(url.searchParams.get('db')).toBe('homy')
    expect(url.searchParams.get('epoch')).toBe('s')
    expect(url.searchParams.get('q')).toBe('SELECT mean("t3") FROM "xymd1"')
    expect(requests[0].auth).toBe(`Basic ${Buffer.from('reader:secret').toString('base64')}`)
})

test('an empty result gives an empty list', async () => {
    reply = (req, res) => json(res, 200, {results: [{statement_id: 0}]})
    await expect(reader().query('SELECT 1')).resolves.toEqual([])
})

test('an error in the result is thrown', async () => {
    reply = (req, res) => json(res, 200, {results: [{statement_id: 0, error: 'field type conflict'}]})
    await expect(reader().query('SELECT 1')).rejects.toThrow('InfluxDB query failed: field type conflict')
})

test('a failed request is thrown with its status', async () => {
    reply = (req, res) => json(res, 401, {error: 'authorization failed'})
    await expect(reader().query('SELECT 1')).rejects.toThrow('InfluxDB query failed: 401 authorization failed')
})
