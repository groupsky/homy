import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { jest } from '@jest/globals'

// Track intercepted requests for testing
let interceptedRequests = []

// Track unhandled external requests (not localhost)
let unhandledExternalRequests = []

const onUnhandledRequest = (req) => {
  // Pass through requests to localhost (test server)
  if (req.url.includes('localhost')) {
    return 'bypass'
  }
  
  // Track unhandled external request
  unhandledExternalRequests.push(`${req.method} ${req.url}`)
  console.error(`[MSW] Unhandled external request: ${req.method} ${req.url}`)
}

// Mock Telegram API
const telegramHandlers = [
  http.post('https://api.telegram.org/bot*/sendMessage', async ({ request }) => {
    const body = await request.json()
    interceptedRequests.push({
      url: request.url,
      method: request.method,
      body: body,
      headers: Object.fromEntries(request.headers.entries())
    })
    
    return HttpResponse.json({
      ok: true,
      result: {
        message_id: Math.floor(Math.random() * 1000000),
        date: Math.floor(Date.now() / 1000),
        chat: { id: parseInt(body.chat_id), type: 'group' },
        text: body.text
      }
    })
  })
]

export const server = setupServer(...telegramHandlers)

// Enable MSW
beforeAll(() => server.listen({ onUnhandledRequest }))

afterEach(() => {
  // Fail test if any unhandled external requests were made
  if (unhandledExternalRequests.length > 0) {
    const requests = [...unhandledExternalRequests]
    unhandledExternalRequests = [] // Clear for next test
    throw new Error(`Test failed: Unhandled external requests detected: ${requests.join(', ')}`)
  }
  
  // Reset for next test
  unhandledExternalRequests = []
  server.resetHandlers()
  interceptedRequests = []
})

afterAll(() => server.close())

// Export function to get intercepted requests
export const getInterceptedRequests = () => interceptedRequests
export const clearInterceptedRequests = () => { interceptedRequests = [] }