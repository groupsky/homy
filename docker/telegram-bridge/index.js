/**
 * Telegram Bridge Service
 * 
 * Receives webhooks from Grafana and forwards them to Telegram Bot API.
 * This allows us to use webhook notifiers in Grafana while still sending to Telegram.
 */

import { loadSecret, maskId } from './src/secrets.js'
import { createTelegramBridgeServer } from './src/server.js'

const PORT = process.env.PORT || 3000

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

console.log('🏠 Starting Telegram Bridge Service...')
console.log(`📡 Listening on port ${PORT}`)
// Never log the token or the full chat id: the log is kept centrally (#1765).
console.log('🔑 Bot token loaded: yes')
console.log(`💬 Chat ID: ${maskId(TELEGRAM_CHAT_ID)}`)

const server = createTelegramBridgeServer(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)

server.listen(PORT, () => {
  console.log(`✅ Telegram Bridge Service running on port ${PORT}`)
  console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/webhook`)
  console.log(`🏥 Health check: http://localhost:${PORT}/health`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...')
  server.close(() => {
    console.log('✅ Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...')
  server.close(() => {
    console.log('✅ Server closed')
    process.exit(0)
  })
})