import http from 'http'
import { extractMessageFromWebhook } from './message-utils.js'
import { sendToTelegram } from './telegram.js'

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

    if (req.method === 'POST' && req.url === '/webhook') {
      await handleWebhook(req, res, botToken, chatId)
      return
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })
}

async function handleWebhook(req, res, botToken, chatId) {
  try {
    // Read the webhook payload
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
    }

    console.log('📥 Webhook received:')
    console.log(`   Content-Type: ${req.headers['content-type']}`)
    console.log(`   Body length: ${body.length}`)

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
    const telegramResult = await sendToTelegram(messageText, botToken, chatId)

    if (telegramResult.success) {
      console.log('✅ Message sent to Telegram successfully')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Webhook processed and sent to Telegram',
        telegramResponse: telegramResult.data
      }))
    } else {
      console.log('❌ Failed to send message to Telegram')
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