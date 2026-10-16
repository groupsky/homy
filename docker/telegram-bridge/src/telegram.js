// `silent` sends the message without sound (Telegram's disable_notification).
export async function sendToTelegram(message, botToken, chatId, { silent = false } = {}) {
  try {
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`

    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_notification: silent
      })
    })

    if (response.ok) {
      const result = await response.json()
      console.log(`📤 Telegram API response: ${result.ok ? 'Success' : 'Failed'}`)
      return { success: result.ok, data: result }
    } else {
      const errorText = await response.text()
      console.error(`❌ Telegram API error (${response.status}): ${errorText}`)
      return { success: false, error: errorText, status: response.status }
    }

  } catch (error) {
    console.error('❌ Error calling Telegram API:', error.message)
    return { success: false, error: error.message }
  }
}
