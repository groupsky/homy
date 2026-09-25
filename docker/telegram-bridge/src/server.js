import http from 'http'
import debug from 'debug'
import { extractMessageFromWebhook } from './message-utils.js'
import { sendToTelegram } from './telegram.js'
import { logSent, normalizeSource, DEFAULT_SOURCE } from './sent-log.js'

// Create debug instances for server operations
const debugServer = debug('telegram-bridge:server')
const debugTelegram = debug('telegram-bridge:telegram')

export function createTelegramBridgeServer(botToken, chatId) {
  return http.createServer(async (req, res) => {
    // Set CORS headers for any potential browser requests
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        status: 'healthy', 
        service: 'telegram-bridge',
        timestamp: new Date().toISOString()
      }))
      return
    }

    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad request URL' }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      debugServer('Webhook POST request received')
      await handleWebhook(req, res, botToken, chatId, url.searchParams.get('source'))
      return
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })
}

async function handleWebhook(req, res, botToken, chatId, querySource) {
  try {
    // Read the webhook payload
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
    }

    console.log('📥 Webhook received:')
    console.log(`   Content-Type: ${req.headers['content-type']}`)
    console.log(`   Body length: ${body.length}`)
    
    debugServer('Webhook headers: %O', req.headers)
    debugServer('Webhook body length: %d bytes', body.length)

    // Parse the webhook payload
    let webhookData
    try {
      webhookData = JSON.parse(body)
    } catch (parseError) {
      console.error('❌ Failed to parse webhook JSON:', parseError.message)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
      return
    }

    // Extract or construct the message text from the webhook
    const messageText = extractMessageFromWebhook(webhookData)
    
    console.log(`📝 Extracted message: ${messageText.substring(0, 200)}${messageText.length > 200 ? '...' : ''}`)

    // Send to Telegram
    debugTelegram('Sending message to Telegram: %s', messageText.substring(0, 100) + (messageText.length > 100 ? '...' : ''))
    const telegramResult = await sendToTelegram(messageText, botToken, chatId)

    // Callers name themselves with a `source` field in a JSON object body, or a
    // ?source= query parameter; the bridge's default is Grafana.
    const bodySource = webhookData && typeof webhookData === 'object' ? webhookData.source : undefined
    logSent({ text: messageText, source: normalizeSource(bodySource) !== DEFAULT_SOURCE ? bodySource : querySource, result: telegramResult, botToken })

    if (telegramResult.success) {
      console.log('✅ Message sent to Telegram successfully')
      debugTelegram('Telegram API response: %O', telegramResult.data)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Webhook processed and sent to Telegram',
        telegramResponse: telegramResult.data
      }))
    } else {
      console.log('❌ Failed to send message to Telegram')
      debugTelegram('Telegram API error: %O', telegramResult.error)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Failed to send to Telegram',
        details: telegramResult.error
      }))
    }

  } catch (error) {
    console.error('❌ Error processing webhook:', error)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      success: false, 
      error: 'Internal server error' 
    }))
  }
}