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
  
  return '⚠️'  // Default warning for unknown alerts
}

export function extractMessageFromWebhook(webhookData) {
  // Handle Grafana webhook format
  if (webhookData.alerts && Array.isArray(webhookData.alerts)) {
    const status = webhookData.status || 'firing'
    const receiver = webhookData.receiver || 'unknown'
    const alerts = webhookData.alerts

    let message = `🏠 <b>Home Automation Alert</b>\n\n`
    message += `<b>Status:</b> ${status.charAt(0).toUpperCase() + status.slice(1)}\n`
    message += `<b>Receiver:</b> ${receiver}\n\n`

    alerts.forEach((alert, index) => {
      const alertName = alert.labels?.alertname || alert.annotations?.summary || 'Unknown Alert'
      const alertMessage = alert.annotations?.message || alert.annotations?.description || 'No details'
      const ruleUid = alert.labels?.rule_uid || 'unknown'
      
      // Get appropriate emoji based on alert name
      const emoji = getAlertEmoji(alertName)
      
      message += `${emoji} <b>${alertName}</b>\n`
      message += `📄 ${alertMessage}\n`
      
      if (alert.generatorURL) {
        message += `🔗 <a href="${alert.generatorURL}">View Dashboard</a>\n`
      }
      
      // Add dashboard link if available
      if (alert.annotations?.__dashboardUid__) {
        const dashboardUrl = `http://grafana.homy.roupsky.name/d/${alert.annotations.__dashboardUid__}`
        const panelId = alert.annotations?.__panelId__
        const fullUrl = panelId ? `${dashboardUrl}?viewPanel=${panelId}` : dashboardUrl
        message += `📊 <a href="${fullUrl}">View Panel</a>\n`
      }
      
      message += `\n`
    })

    message += `🕐 ${new Date().toLocaleString('bg-BG', { 
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