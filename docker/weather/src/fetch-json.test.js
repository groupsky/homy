const http = require('http')
const {fetchJson} = require('./fetch-json')

let server
let base
let reply

beforeAll(async () => {
    server = http.createServer((req, res) => reply(req, res))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
})

test('returns the JSON body of a good answer', async () => {
    reply = (req, res) => res.writeHead(200, {'content-type': 'application/json'}).end('{"hourly":{"time":[1]}}')
    await expect(fetchJson(`${base}/v1/forecast?latitude=1.23`)).resolves.toEqual({hourly: {time: [1]}})
})

test('throws the reason Open-Meteo gives', async () => {
    reply = (req, res) => res.writeHead(400, {'content-type': 'application/json'}).end('{"error":true,"reason":"Invalid value"}')
    await expect(fetchJson(`${base}/x`)).rejects.toThrow('Open-Meteo answered 400: Invalid value')
})

test('throws the status of an answer that is not JSON', async () => {
    reply = (req, res) => res.writeHead(502).end('<html>Bad gateway</html>')
    await expect(fetchJson(`${base}/x`)).rejects.toThrow('Open-Meteo answered 502')
})

test('a failed connection does not put the URL, with the location, in the error', async () => {
    const closed = http.createServer()
    await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve))
    const freePort = closed.address().port
    await new Promise(resolve => closed.close(resolve))
    const error = await fetchJson(`http://127.0.0.1:${freePort}/v1/forecast?latitude=12.34&longitude=56.78`).catch(e => e)
    expect(error.message).toMatch(/^Open-Meteo request failed/)
    expect(error.message).not.toContain('12.34')
    expect(error.message).not.toContain('56.78')
})
