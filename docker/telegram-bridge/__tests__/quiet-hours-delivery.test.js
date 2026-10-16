import { jest } from '@jest/globals'
import { getInterceptedRequests, clearInterceptedRequests } from './setup.js'

const NIGHT = new Date('2026-11-03T02:00:00+02:00')
const DAY = new Date('2026-11-03T12:00:00+02:00')

describe('quiet hours delivery', () => {
  let serverInstance
  let baseUrl
  let now
  let logSpy

  beforeAll(async () => {
    const { createTelegramBridgeServer } = await import('../src/server.js')
    serverInstance = createTelegramBridgeServer('test-bot-token', '-123456789', { now: () => now })
    await new Promise((resolve) => {
      serverInstance.listen(0, () => {
        baseUrl = `http://localhost:${serverInstance.address().port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise((resolve) => serverInstance.close(resolve))
  })

  beforeEach(() => {
    clearInterceptedRequests()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  const post = async (payload) => {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(200)
    const requests = getInterceptedRequests()
    expect(requests).toHaveLength(1)
    return requests[0].body
  }

  const sentLine = () => logSpy.mock.calls
    .map(([line]) => line)
    .filter((line) => typeof line === 'string' && line.includes('"telegram.sent"'))
    .map((line) => JSON.parse(line))
    .at(-1)

  const alert = (labels) => ({
    status: 'firing',
    alerts: [{ status: 'firing', labels: { alertname: 'Миялна (Webhook)', ...labels }, annotations: {} }],
  })

  test('a non-safety alert at night is sent with disable_notification', async () => {
    now = NIGHT
    const body = await post(alert({}))
    expect(body.disable_notification).toBe(true)
    expect(sentLine().silent).toBe(true)
  })

  test('a safety alert at night rings', async () => {
    now = NIGHT
    const body = await post(alert({ safety: 'true' }))
    expect(body.disable_notification).toBe(false)
    expect(sentLine().silent).toBe(false)
  })

  test('a direct message with "safety": true at night rings', async () => {
    now = NIGHT
    const body = await post({ message: 'Safety test', safety: true })
    expect(body.disable_notification).toBe(false)
    expect(sentLine().silent).toBe(false)
  })

  test('a non-safety alert in the day rings', async () => {
    now = DAY
    const body = await post(alert({}))
    expect(body.disable_notification).toBe(false)
    expect(sentLine().silent).toBe(false)
  })
})
