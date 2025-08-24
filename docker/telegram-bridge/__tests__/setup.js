import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// Track intercepted requests for testing
let interceptedRequests = []

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
beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  interceptedRequests = []
})
afterAll(() => server.close())

// Export function to get intercepted requests
export const getInterceptedRequests = () => interceptedRequests
export const clearInterceptedRequests = () => { interceptedRequests = [] }