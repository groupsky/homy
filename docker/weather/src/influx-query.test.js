const http = require('http')
const {createReader} = require('./influx-query')

let server
let reply
let requests

beforeAll(async () => {
    server = http.createServer((req, res) => {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
            requests.push({method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body})
            reply(req, res)
        })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
})

beforeEach(() => { requests = [] })

afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
})

function reader() {
    return createReader({url: `http://127.0.0.1:${server.address().port}`, database: 'homy', token: 'reader:secret'})
}

const json = (res, status, body) => res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body))

test('posts InfluxQL to /query with epoch seconds and the read token, and returns the series', async () => {
    const series = [{name: 'xymd1', columns: ['time', 'mean', 'count'], values: [[1705345200, 1.5, 700]]}]
    reply = (req, res) => json(res, 200, {results: [{statement_id: 0, series}]})
    await expect(reader().query('SELECT mean("t3") FROM "xymd1"')).resolves.toEqual(series)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('/query')
    expect(requests[0].type).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(requests[0].body)
    expect(form.get('db')).toBe('homy')
    expect(form.get('epoch')).toBe('s')
    expect(form.get('q')).toBe('SELECT mean("t3") FROM "xymd1"')
    expect(requests[0].auth).toBe('Token reader:secret')
})

test('an empty result gives an empty list', async () => {
    reply = (req, res) => json(res, 200, {results: [{statement_id: 0}]})
    await expect(reader().query('SELECT 1')).resolves.toEqual([])
})

test('an error in the result is thrown', async () => {
    reply = (req, res) => json(res, 200, {results: [{statement_id: 0, error: 'field type conflict'}]})
    await expect(reader().query('SELECT 1')).rejects.toThrow('InfluxDB query failed: field type conflict')
})

test('a failed request is thrown with its status, without the token', async () => {
    reply = (req, res) => json(res, 401, {error: 'authorization failed'})
    const error = await reader().query('SELECT 1').catch(e => e)
    expect(error.message).toMatch(/^InfluxDB query failed: 401 .*authorization failed/)
    expect(error.message).not.toContain('secret')
})
