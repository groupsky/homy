import { jest } from '@jest/globals'
import http from 'http'
import { server, getInterceptedRequests, clearInterceptedRequests } from './setup.js'
import { http as mswHttp, HttpResponse } from 'msw'

// Set environment variables for testing
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
process.env.TELEGRAM_CHAT_ID = '-123456789'
process.env.PORT = '0' // Use random available port

describe('Telegram Bridge Service', () => {
  let serverInstance
  let baseUrl

  beforeAll(async () => {
    // Import server creation function instead of starting the service
    const { createTelegramBridgeServer } = await import('../src/server.js')

    // Create server instance
    serverInstance = createTelegramBridgeServer('test-bot-token', '-123456789')

    // Start server on random port
    await new Promise((resolve) => {
      serverInstance.listen(0, () => {
        const port = serverInstance.address().port
        baseUrl = `http://localhost:${port}`
        resolve()
      })
    })
  }, 10000)

  afterAll(async () => {
    if (serverInstance) {
      await new Promise((resolve) => {
        serverInstance.close(resolve)
      })
    }
  })

  describe('Health endpoint', () => {
    test('GET /health returns healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('healthy')
      expect(data.service).toBe('telegram-bridge')
      expect(data.timestamp).toBeDefined()
    })
  })

  describe('Webhook endpoint', () => {
    test('POST /webhook processes Grafana alert successfully and verifies Telegram payload', async () => {
      clearInterceptedRequests()

      const grafanaWebhook = {
        status: 'firing',
        receiver: 'telegram-alerts',
        alerts: [{
          labels: {
            alertname: 'High Temperature',
            rule_uid: 'test-rule-123'
          },
          annotations: {
            message: 'Temperature is above 30°C',
            description: 'Server room temperature critical'
          },
          generatorURL: 'http://grafana.example.com/alerting/rule/123'
        }]
      }

      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(grafanaWebhook)
      })

      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Webhook processed and sent to Telegram')
      expect(data.telegramResponse).toBeDefined()

      // Verify the actual payload sent to Telegram
      const requests = getInterceptedRequests()
      expect(requests).toHaveLength(1)

      const telegramRequest = requests[0]
      expect(telegramRequest.url).toMatch(/https:\/\/api\.telegram\.org\/bot.*\/sendMessage/)
      expect(telegramRequest.method).toBe('POST')
      expect(telegramRequest.body.chat_id).toBe('-123456789')
      expect(telegramRequest.body.parse_mode).toBe('HTML')

      // Verify message content includes expected elements
      expect(telegramRequest.body.text).toMatchInlineSnapshot(`
"🚨 Temperature is above 30°C
"
`)
    })

    test('POST /webhook handles simple message object and verifies payload', async () => {
      clearInterceptedRequests()

      const simpleMessage = {
        message: 'Test alert message'
      }

      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(simpleMessage)
      })

      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      // Verify the actual payload sent to Telegram
      const requests = getInterceptedRequests()
      expect(requests).toHaveLength(1)

      const telegramRequest = requests[0]
      expect(telegramRequest.body.text).toBe('Test alert message')
      expect(telegramRequest.body.chat_id).toBe('-123456789')
      expect(telegramRequest.body.parse_mode).toBe('HTML')
    })

    test('POST /webhook handles invalid JSON', async () => {
      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: 'invalid json'
      })

      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid JSON payload')
    })

    test('POST /webhook handles Telegram API failure', async () => {
      // Override MSW handler to return error
      server.use(
        mswHttp.post('https://api.telegram.org/bot*/sendMessage', () => {
          return HttpResponse.json(
            { ok: false, error_code: 400, description: 'Bad Request' },
            { status: 400 }
          )
        })
      )

      const testMessage = { message: 'Test message' }

      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testMessage)
      })

      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.success).toBe(false)
      expect(data.error).toBe('Failed to send to Telegram')
      expect(data.details).toContain('Bad Request')
    })
  })

  describe('Message extraction', () => {
    test('extracts message from Grafana webhook with multiple alerts and verifies emojis', async () => {
      clearInterceptedRequests()

      const multiAlertWebhook = {
        status: 'firing',
        receiver: 'critical-alerts',
        alerts: [
          {
            labels: { alertname: 'Цисла вода' },
            annotations: { message: 'Water level critical' }
          },
          {
            labels: { alertname: 'High Power Usage' },
            annotations: { message: 'Power consumption above threshold' }
          }
        ]
      }

      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(multiAlertWebhook)
      })

      expect(response.status).toBe(200)

      // Verify the actual payload sent to Telegram includes correct emojis
      const requests = getInterceptedRequests()
      expect(requests).toHaveLength(1)

      expect(requests[0].body.text).toMatchInlineSnapshot(`
"🚨 Water level critical

🚨 Power consumption above threshold
"
`)
    })

    test('extracts message from object with text field', async () => {
      const textMessage = { text: 'Simple text message' }

      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(textMessage)
      })

      expect(response.status).toBe(200)
    })
  })

  describe('CORS handling', () => {
    test('OPTIONS request returns CORS headers', async () => {
      const response = await fetch(`${baseUrl}/webhook`, {
        method: 'OPTIONS'
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, GET, OPTIONS')
    })
  })

  describe('Unknown routes', () => {
    test('GET /unknown returns 404', async () => {
      const response = await fetch(`${baseUrl}/unknown`)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Not found')
    })
  })
})
