import { jest } from '@jest/globals'
import { server } from './setup.js'
import { http as mswHttp, HttpResponse } from 'msw'
import { buildSentLine, normalizeSource } from '../src/sent-log.js'

const TOKEN = 'test-bot-token'

describe('buildSentLine', () => {
  test('success line carries the full text and the message id', () => {
    const line = JSON.parse(buildSentLine({
      text: 'hello',
      source: 'ioniq-dtc',
      result: { success: true, data: { ok: true, result: { message_id: 4711 } } },
      botToken: TOKEN,
    }))
    expect(line).toEqual({
      event: 'telegram.sent',
      sender: 'telegram-bridge',
      source: 'ioniq-dtc',
      origin_host: 'routy',
      ok: true,
      message_id: 4711,
      error: null,
      text: 'hello',
    })
  })

  test('API failure takes the description from the Bot API body', () => {
    const line = JSON.parse(buildSentLine({
      text: 'x',
      result: { success: false, error: '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}', status: 400 },
      botToken: TOKEN,
    }))
    expect(line.ok).toBe(false)
    expect(line.message_id).toBeNull()
    expect(line.error).toBe('Bad Request: chat not found')
    expect(line.source).toBe('grafana')
  })

  test('transport error is kept and the bot token is removed from it', () => {
    const line = JSON.parse(buildSentLine({
      text: 'x',
      result: { success: false, error: `request to https://api.telegram.org/bot${TOKEN}/sendMessage failed` },
      botToken: TOKEN,
    }))
    expect(line.error).toBe('request to https://api.telegram.org/bot[redacted]/sendMessage failed')
    expect(JSON.stringify(line)).not.toContain(TOKEN)
  })

  test('is one line for multi-line text', () => {
    const out = buildSentLine({ text: 'a\nb\r\nc', result: { success: true, data: { result: { message_id: 1 } } } })
    expect(out).not.toMatch(/[\r\n]/)
    expect(JSON.parse(out).text).toBe('a\nb\r\nc')
  })

  test('has no chat id field', () => {
    const out = buildSentLine({ text: 'x', result: { success: true, data: { result: { message_id: 1 } } } })
    expect(Object.keys(JSON.parse(out))).not.toContain('chat_id')
  })
})

describe('normalizeSource', () => {
  test.each([[undefined], [null], [''], ['   '], [42], [{}], ['x'.repeat(65)]])('%p falls back to grafana', (v) => {
    expect(normalizeSource(v)).toBe('grafana')
  })
  test('keeps a short name', () => {
    expect(normalizeSource(' ioniq-dtc ')).toBe('ioniq-dtc')
  })
})

describe('bridge writes a telegram.sent line per Bot API call', () => {
  let serverInstance, baseUrl, logSpy

  const sentLines = () => logSpy.mock.calls
    .map((c) => c[0])
    .filter((l) => typeof l === 'string' && l.startsWith('{'))
    .map((l) => JSON.parse(l))
    .filter((l) => l.event === 'telegram.sent')

  beforeAll(async () => {
    const { createTelegramBridgeServer } = await import('../src/server.js')
    serverInstance = createTelegramBridgeServer(TOKEN, '-123456789')
    await new Promise((resolve) => serverInstance.listen(0, () => {
      baseUrl = `http://localhost:${serverInstance.address().port}`
      resolve()
    }))
  })
  afterAll(() => new Promise((resolve) => serverInstance.close(resolve)))
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => logSpy.mockRestore())

  const post = (path, body) => fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  test('grafana alert: one line, default source, real message id', async () => {
    const res = await post('/webhook', { status: 'firing', alerts: [{ labels: { alertname: 'A' }, annotations: { message: 'Boom' } }] })
    expect(res.status).toBe(200)
    const lines = sentLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ ok: true, source: 'grafana', sender: 'telegram-bridge', error: null, text: '🚨 Boom\n' })
    expect(Number.isInteger(lines[0].message_id)).toBe(true)
  })

  test('source from the body, or from the query string', async () => {
    await post('/webhook', { source: 'ioniq-dtc', message: 'dtc' })
    await post('/webhook?source=other-bot', { message: 'o' })
    expect(sentLines().map((l) => l.source)).toEqual(['ioniq-dtc', 'other-bot'])
  })

  test('long text with & and + is logged in full and sent intact', async () => {
    let sent
    server.use(mswHttp.post('https://api.telegram.org/bot*/sendMessage', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ ok: true, result: { message_id: 9 } })
    }))
    const text = `a&b+c ${'0123456789'.repeat(150)}`
    await post('/webhook', { message: text })
    expect(text.length).toBeGreaterThan(1024)
    expect(sent.text).toBe(text)
    expect(sentLines()[0].text).toBe(text)
  })

  test('failed send: ok false and the API description', async () => {
    server.use(mswHttp.post('https://api.telegram.org/bot*/sendMessage', () =>
      HttpResponse.json({ ok: false, error_code: 400, description: 'Bad Request: message is too long' }, { status: 400 })))
    const res = await post('/webhook', { message: 'x' })
    expect(res.status).toBe(500)
    const lines = sentLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ ok: false, message_id: null, error: 'Bad Request: message is too long', text: 'x' })
  })

  test('an unusable body source does not hide the query source', async () => {
    await post('/webhook?source=other-bot', { source: '', message: 'o' })
    expect(sentLines().map((l) => l.source)).toEqual(['other-bot'])
  })

  test('a malformed request URL gets 400 and the server keeps running', async () => {
    const net = await import('net')
    const port = serverInstance.address().port
    const reply = await new Promise((resolve) => {
      const sock = net.connect(port, 'localhost', () => sock.write('GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
      let data = ''
      sock.on('data', (d) => { data += d })
      sock.on('close', () => resolve(data))
    })
    expect(reply).toMatch(/^HTTP\/1\.1 400/)
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200)
  })

  test('invalid JSON sends nothing and logs nothing', async () => {
    await fetch(`${baseUrl}/webhook`, { method: 'POST', body: 'nope' })
    expect(sentLines()).toHaveLength(0)
  })
})
