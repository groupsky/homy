/**
 * Telegram client utilities for E2E testing
 * Provides functions to verify Telegram bot message delivery
 */

import fs from 'fs'

/**
 * Read Telegram bot configuration from secrets
 * @returns {Promise<{readerToken: string, chatId: string}>} Bot configuration
 */
export async function getTelegramConfig() {
  // In test environment, secrets might be mounted or in environment variables
  const readerTokenPath = process.env.TELEGRAM_READER_TOKEN_FILE || '/run/secrets/telegram_reader_bot_token'
  const chatIdPath = process.env.TELEGRAM_CHAT_ID_FILE || '/run/secrets/telegram_chat_id'
  
  try {
    const readerToken = fs.readFileSync(readerTokenPath, 'utf8').trim()
    const chatId = fs.readFileSync(chatIdPath, 'utf8').trim()
    
    return { readerToken, chatId }
  } catch (error) {
    throw new Error(`Failed to read Telegram config: ${error.message}`)
  }
}

/**
 * Get recent messages from Telegram bot
 * @param {string} token - Bot token
 * @param {number} timeoutMs - How long to look back (default 60s)
 * @returns {Promise<Array>} Array of recent messages
 */
export async function getRecentMessages(token, timeoutMs = 60000) {
  const url = `https://api.telegram.org/bot${token}/getUpdates`
  
  try {
    const response = await fetch(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'E2E-Test-Client/1.0'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`)
    }
    
    // Filter messages from the last timeoutMs milliseconds
    const cutoffTime = Date.now() - timeoutMs
    const recentMessages = data.result
      .filter(update => update.message && update.message.date * 1000 > cutoffTime)
      .map(update => update.message)
    
    return recentMessages
  } catch (error) {
    throw new Error(`Failed to fetch Telegram messages: ${error.message}`)
  }
}

/**
 * Wait for actual Grafana alert notification in Telegram chat
 * Uses a reader bot to check for messages sent by the alert bot
 * This provides true end-to-end validation of the alerting pipeline
 * 
 * @param {string} readerToken - Reader bot token (can read all chat messages)
 * @param {string} expectedChatId - Expected chat ID for alerts
 * @param {Array<string>} expectedKeywords - Keywords that should appear in alert message
 * @param {number} timeoutMs - How long to wait for alert (default 120s)
 * @returns {Promise<{success: boolean, message?: object, error?: string}>}
 */
export async function waitForAlertMessage(readerToken, expectedChatId, expectedKeywords = [], timeoutMs = 120000) {
  const startTime = Date.now()
  const testStartTimestamp = Math.floor(startTime / 1000) // Convert to Unix timestamp
  const pollInterval = 10000 // Check every 10 seconds
  
  // Get current update_id to avoid processing old messages
  let lastUpdateId = 0
  try {
    const initialUpdates = await getChatUpdates(readerToken, 0)
    if (initialUpdates.length > 0) {
      lastUpdateId = Math.max(...initialUpdates.map(u => u.update_id)) + 1
    }
  } catch (error) {
    console.log(`⚠️  Could not get initial update_id, starting from 0: ${error.message}`)
  }
  
  console.log(`🔔 Waiting for Grafana alert message in chat ${expectedChatId}...`)
  console.log(`   Expected keywords: ${expectedKeywords.join(', ')}`)
  console.log(`   Timeout: ${timeoutMs / 1000}s`)
  console.log(`   Test start time: ${new Date(testStartTimestamp * 1000).toISOString()}`)
  console.log(`   Starting from update_id: ${lastUpdateId}`)
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Get chat updates using the reader bot
      const updates = await getChatUpdates(readerToken, lastUpdateId)
      
      if (updates.length > 0) {
        console.log(`📬 Received ${updates.length} new updates`)
        
        // Update the last seen update ID
        lastUpdateId = Math.max(...updates.map(u => u.update_id)) + 1
        
        // Look for messages in the target chat that contain expected keywords
        for (const update of updates) {
          if (update.message && update.message.chat.id.toString() === expectedChatId.toString()) {
            const message = update.message
            const text = message.text || ''
            const messageTimestamp = message.date
            
            console.log(`📝 Chat message: "${text.substring(0, 80)}..."`)
            console.log(`   From: ${message.from ? message.from.username || message.from.first_name : 'Bot'}`)
            console.log(`   Time: ${new Date(messageTimestamp * 1000).toISOString()}`)
            console.log(`   Age: ${Math.floor((testStartTimestamp - messageTimestamp) / 60)} minutes before test`)
            
            // Only consider messages sent after the test started (plus small buffer for clock differences)
            const bufferSeconds = 30 // Allow 30 second clock difference
            if (messageTimestamp < (testStartTimestamp - bufferSeconds)) {
              console.log(`   ⏰ Skipping old message (sent before test started)`)
              continue
            }
            
            // Check if this message contains all expected keywords (case insensitive)
            const hasAllKeywords = expectedKeywords.every(keyword => 
              text.toLowerCase().includes(keyword.toLowerCase())
            )
            
            if (hasAllKeywords) {
              console.log(`✅ Found matching Grafana alert message!`)
              
              return { 
                success: true, 
                message: {
                  text,
                  timestamp: messageTimestamp,
                  chatId: message.chat.id,
                  from: message.from,
                  messageId: message.message_id
                }
              }
            } else {
              console.log(`   ❌ Message doesn't contain all required keywords`)
            }
          }
        }
      } else {
        console.log(`⏳ No new updates, continuing to wait...`)
      }
      
      const elapsed = Date.now() - startTime
      const remaining = Math.round((timeoutMs - elapsed) / 1000)
      console.log(`⏳ No alert found yet, waiting... (${remaining}s remaining)`)
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      
    } catch (error) {
      console.log(`⚠️  Error polling for alert messages: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
  }
  
  return { 
    success: false, 
    error: `No Grafana alert message found within ${timeoutMs / 1000}s. Expected keywords: ${expectedKeywords.join(', ')}` 
  }
}

/**
 * Test Telegram bot connectivity
 * @param {string} token - Bot token
 * @returns {Promise<{success: boolean, botInfo?: object, error?: string}>}
 */
export async function testTelegramBot(token) {
  const url = `https://api.telegram.org/bot${token}/getMe`
  
  try {
    const response = await fetch(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'E2E-Test-Client/1.0'
      }
    })
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }
    
    const data = await response.json()
    
    if (!data.ok) {
      return { success: false, error: `Bot test failed: ${data.description}` }
    }
    
    return { 
      success: true, 
      botInfo: {
        username: data.result.username,
        firstName: data.result.first_name,
        canJoinGroups: data.result.can_join_groups,
        canReadAllGroupMessages: data.result.can_read_all_group_messages
      }
    }
  } catch (error) {
    return { success: false, error: `Failed to test bot: ${error.message}` }
  }
}

/**
 * Get information about a chat
 * @param {string} token - Bot token
 * @param {string} chatId - Chat ID to get info for
 * @returns {Promise<{success: boolean, chat?: object, error?: string}>}
 */
export async function getChatInfo(token, chatId) {
  const url = `https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`
  
  try {
    const response = await fetch(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'E2E-Test-Client/1.0'
      }
    })
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }
    
    const data = await response.json()
    
    if (!data.ok) {
      return { success: false, error: `Get chat info failed: ${data.description}` }
    }
    
    return { 
      success: true, 
      chat: {
        id: data.result.id,
        type: data.result.type,
        title: data.result.title,
        username: data.result.username
      }
    }
  } catch (error) {
    return { success: false, error: `Failed to get chat info: ${error.message}` }
  }
}

/**
 * Send a test message to validate notification capability
 * @param {string} token - Bot token
 * @param {string} chatId - Chat ID to send message to
 * @param {string} message - Message text
 * @returns {Promise<{success: boolean, messageId?: number, error?: string}>}
 */
export async function sendTestMessage(token, chatId, message) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'E2E-Test-Client/1.0'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    })
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }
    
    const data = await response.json()
    
    if (!data.ok) {
      return { success: false, error: `Send message failed: ${data.description}` }
    }
    
    return { 
      success: true, 
      messageId: data.result.message_id
    }
  } catch (error) {
    return { success: false, error: `Failed to send test message: ${error.message}` }
  }
}

/**
 * Get chat updates using Telegram getUpdates API
 * @param {string} token - Bot token
 * @param {number} offset - Offset for getting new updates
 * @returns {Promise<Array>} Array of update objects
 */
export async function getChatUpdates(token, offset = 0) {
  let url = `https://api.telegram.org/bot${token}/getUpdates?limit=100`
  if (offset > 0) {
    url += `&offset=${offset}`
  }
  
  try {
    const response = await fetch(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'E2E-Test-Client/1.0'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    
    if (!data.ok) {
      throw new Error(`Get updates failed: ${data.description}`)
    }
    
    return data.result || []
  } catch (error) {
    throw new Error(`Failed to get chat updates: ${error.message}`)
  }
}