export function getAlertEmoji(alertName) {
  const name = alertName.toLowerCase()

  // Bulgarian alerts from actual Grafana configuration
  if (name.includes('термопомпа')) return '🌡️'  // Heat pump alerts (Bulgarian)
  if (name.includes('алармa за водната помпа') || name.includes('water pump')) return '💧'  // Water pump
  if (name.includes('миялна')) return '🍽️'  // Dishwasher (Bulgarian)

  // English alerts from actual configuration
  if (name.includes('ac alert') || name.includes('voltage')) return '🔌'  // AC voltage alert
  if (name.includes('main power')) return '⚡'  // Main power alert

  // Generic category matching for backward compatibility
  if (name.includes('цисла')) return '💧'  // Water (Bulgarian)
  if (name.includes('сигла')) return '🔴'  // Signal (Bulgarian)
  if (name.includes('heat') || name.includes('temperature')) return '🌡️'  // Heat/temperature
  if (name.includes('power')) return '⚡'  // Power
  if (name.includes('water') || name.includes('pump')) return '💧'  // Water/pump
  if (name.includes('ac') || name.includes('voltage')) return '🔌'  // AC/voltage
  if (name.includes('humidity')) return '💨'  // Humidity
  if (name.includes('dishwasher')) return '🍽️'  // Dishwasher
  if (name.includes('пералня') || name.includes('washing machine')) return '🫧👕'

  return '⚠️'  // Default warning for unknown alerts
}

export function getStatusEmoji(status) {
    switch (status.toLowerCase()) {
        case 'firing':
        case 'critical':
        case 'alerting':
            return '🚨'
        case 'resolved':
        case 'ok':
            return '✅'
        case 'warning':
            return '⚠️'
        default:
            return 'ℹ️'
    }
}

export function extractMessageFromWebhook(webhookData) {
  // Handle Grafana webhook format
  if (webhookData.alerts && Array.isArray(webhookData.alerts)) {
    const status = webhookData.status || 'firing'
    const alerts = webhookData.alerts

    const statusEmoji = getStatusEmoji(status)

    const message = alerts.map((alert) => {
        if (alert.annotations?.message) {
            return `${statusEmoji} ${alert.annotations.message}\n`
        }

      return `${statusEmoji} <b>${alert.annotations?.summary || alert.labels?.alertname || 'Unknown Alert'}</b>\n${alert.annotations?.description || ''}`
    }).join('\n')

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
