import debug from 'debug'

// Create debug instances for different aspects of the service
const debugWebhook = debug('telegram-bridge:webhook')
const debugMessage = debug('telegram-bridge:message')

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
        case 'nodata':
            return '📵'  // No data/mobile off
        case 'error':
            return '🚧'  // Under construction/broken
        default:
            return 'ℹ️'
    }
}

function isSystemAlert(alert) {
  return alert.labels?.alertname === 'DatasourceNoData' || alert.labels?.alertname === 'DatasourceError'
}

function formatSystemAlert(alert, overallStatus) {
  const isError = alert.labels?.alertname === 'DatasourceError'
  const isResolved = overallStatus === 'resolved'
  
  // Use single emojis - different for resolved vs active states
  let statusEmoji
  if (isResolved) {
    statusEmoji = '✅'  // Always use checkmark for resolved
  } else {
    statusEmoji = isError ? '🚧' : '📵'  // Under construction for error, no data for no data
  }
  
  const systemType = isError ? 'ALERT SYSTEM' : 'DATA SOURCE'
  const systemStatus = isResolved ? 'RECOVERED' : (isError ? 'ERROR' : 'ISSUE')
  const statusText = `${systemType} ${systemStatus}`
  
  const ruleName = alert.labels?.rulename || 'Unknown Rule'
  const description = alert.annotations?.description || alert.annotations?.summary || 'System alert'
  
  return `${statusEmoji} <b>${statusText}</b>\n<i>Alert Rule:</i> "${ruleName}"\n${description}`
}

export function extractMessageFromWebhook(webhookData) {
  // Debug log the incoming webhook data
  debugWebhook('Received Grafana webhook: %O', webhookData)
  
  // Handle Grafana webhook format
  if (webhookData.alerts && Array.isArray(webhookData.alerts)) {
    const status = webhookData.status || 'firing'
    const alerts = webhookData.alerts

    const statusEmoji = getStatusEmoji(status)

    const message = alerts.map((alert) => {
        // Handle system alerts (DatasourceNoData, DatasourceError) with special formatting
        if (isSystemAlert(alert)) {
            debugMessage('Processing system alert: %s', alert.labels?.alertname)
            return formatSystemAlert(alert, status)
        }
        
        debugMessage('Processing regular alert: %s', alert.labels?.alertname || 'Unknown')
        
        if (alert.annotations?.message) {
            return `${statusEmoji} ${alert.annotations.message}\n`
        }

      return `${statusEmoji} <b>${alert.annotations?.summary || alert.labels?.alertname || 'Unknown Alert'}</b>\n${alert.annotations?.description || ''}`
    }).join('\n')

    debugMessage('Generated message text: %s', message.substring(0, 100) + (message.length > 100 ? '...' : ''))
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
  debugWebhook('Using fallback JSON stringify for webhook data')
  return `Webhook received:\n\n${JSON.stringify(webhookData, null, 2)}`
}

export { debugWebhook, debugMessage }
