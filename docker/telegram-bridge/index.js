/**
 * Telegram Bridge Service
 * 
 * Receives webhooks from Grafana and forwards them to Telegram Bot API.
 * This allows us to use webhook notifiers in Grafana while still sending to Telegram.
 */

import http from 'http'
import fetch from 'node-fetch'
import fs from 'fs'

const PORT = process.env.PORT || 3000

// Load secrets from files (Docker secrets pattern)
function loadSecret(name) {
  const fileEnvVar = `${name}_FILE`
  const directEnvVar = name
  
  if (process.env[fileEnvVar]) {
    try {
      return fs.readFileSync(process.env[fileEnvVar], 'utf8').trim()
    } catch (error) {
      console.error(`Failed to read secret from file ${process.env[fileEnvVar]}:`, error.message)
      return null
    }
  } else if (process.env[directEnvVar]) {
    return process.env[directEnvVar]
  }
  
  return null
}

const TELEGRAM_BOT_TOKEN = loadSecret('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_ID = loadSecret('TELEGRAM_CHAT_ID')

if (!TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is required (set via TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN_FILE)')
  process.exit(1)
}

if (!TELEGRAM_CHAT_ID) {
  console.error('ERROR: TELEGRAM_CHAT_ID is required (set via TELEGRAM_CHAT_ID or TELEGRAM_CHAT_ID_FILE)')
  process.exit(1)
}

console.log('<	 Starting Telegram Bridge Service...')
console.log(`=á Listening on port ${PORT}`)
console.log(`> Bot token: ${TELEGRAM_BOT_TOKEN.substring(0, 10)}...`)
console.log(`=¬ Chat ID: ${TELEGRAM_CHAT_ID}`)

function getAlertEmoji(alertName) {
  const name = alertName.toLowerCase()
  if (name.includes('?5@0;=O')) return '=U'
  if (name.includes('<8O;=0')) return '<}'
  if (name.includes('B5@<>?><?0') || name.includes('heat')) return '<!'
  if (name.includes('power') || name.includes('power')) return '¡'
  if (name.includes('water') || name.includes('pump')) return '=§'
  if (name.includes('ac') || name.includes('voltage')) return '='
  if (name.includes('temperature')) return '<!'
  if (name.includes('humidity')) return '=§'
  return ' '
}

const server = http.createServer(async (req, res) => {
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
    await handleWebhook(req, res)
    return
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

async function handleWebhook(req, res) {
  try {
    // Read the webhook payload
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
    }

    console.log('=è Webhook received:')
    console.log(`   Content-Type: ${req.headers['content-type']}`)
    console.log(`   Body length: ${body.length}`)

    // Parse the webhook payload
    let webhookData
    try {
      webhookData = JSON.parse(body)
    } catch (parseError) {
      console.error('L Failed to parse webhook JSON:', parseError.message)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
      return
    }

    // Extract or construct the message text from the webhook
    const messageText = extractMessageFromWebhook(webhookData)
    
    console.log(`=Ý Extracted message: ${messageText.substring(0, 200)}${messageText.length > 200 ? '...' : ''}`)

    // Send to Telegram
    const telegramSuccess = await sendToTelegram(messageText)

    if (telegramSuccess) {
      console.log(' Message sent to Telegram successfully')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Webhook processed and sent to Telegram' 
      }))
    } else {
      console.log('L Failed to send message to Telegram')
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Failed to send to Telegram' 
      }))
    }

  } catch (error) {
    console.error('L Error processing webhook:', error)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      success: false, 
      error: 'Internal server error' 
    }))
  }
}

function extractMessageFromWebhook(webhookData) {
  // Handle Grafana webhook format
  if (webhookData.alerts && Array.isArray(webhookData.alerts)) {
    const status = webhookData.status || 'firing'
    const receiver = webhookData.receiver || 'unknown'
    const alerts = webhookData.alerts

    let message = `<à <b>Home Automation Alert</b>\n\n`
    message += `<b>Status:</b> ${status.charAt(0).toUpperCase() + status.slice(1)}\n`
    message += `<b>Receiver:</b> ${receiver}\n\n`

    alerts.forEach((alert, index) => {
      const alertName = alert.labels?.alertname || alert.annotations?.summary || 'Unknown Alert'
      const alertMessage = alert.annotations?.message || alert.annotations?.description || 'No details'
      const ruleUid = alert.labels?.rule_uid || 'unknown'
      
      // Get appropriate emoji based on alert name
      const emoji = getAlertEmoji(alertName)
      
      message += `${emoji} <b>${alertName}</b>\n`
      message += `=¬ ${alertMessage}\n`
      
      if (alert.generatorURL) {
        message += `= <a href="${alert.generatorURL}">View Dashboard</a>\n`
      }
      
      // Add dashboard link if available
      if (alert.annotations?.__dashboardUid__) {
        const dashboardUrl = `http://grafana.homy.roupsky.name/d/${alert.annotations.__dashboardUid__}`
        const panelId = alert.annotations?.__panelId__
        const fullUrl = panelId ? `${dashboardUrl}?viewPanel=${panelId}` : dashboardUrl
        message += `=Ê <a href="${fullUrl}">View Panel</a>\n`
      }
      
      message += `\n`
    })

    message += `ð ${new Date().toLocaleString('bg-BG', { 
      timeZone: 'Europe/Sofia',
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })}`
    
    return message
  }

  // Handle raw text messages
  if (typeof webhookData === 'string') {
    return webhookData
  }

  // Handle simple object with message field
  if (webhookData.message) {
    return webhookData.message
  }

  // Handle simple object with text field  
  if (webhookData.text) {
    return webhookData.text
  }

  // Fallback: stringify the entire payload
  return `Webhook received:\n\n${JSON.stringify(webhookData, null, 2)}`
}

async function sendToTelegram(message) {
  try {
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    })

    if (response.ok) {
      const result = await response.json()
      console.log(`=ñ Telegram API response: ${result.ok ? 'Success' : 'Failed'}`)
      return result.ok
    } else {
      const errorText = await response.text()
      console.error(`L Telegram API error (${response.status}): ${errorText}`)
      return false
    }

  } catch (error) {
    console.error('L Error calling Telegram API:', error.message)
    return false
  }
}

server.listen(PORT, () => {
  console.log(` Telegram Bridge Service running on port ${PORT}`)
  console.log(`= Webhook endpoint: http://localhost:${PORT}/webhook`)
  console.log(`<å Health check: http://localhost:${PORT}/health`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('=Ñ Received SIGTERM, shutting down gracefully...')
  server.close(() => {
    console.log(' Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('=Ñ Received SIGINT, shutting down gracefully...')
  server.close(() => {
    console.log(' Server closed')
    process.exit(0)
  })
})