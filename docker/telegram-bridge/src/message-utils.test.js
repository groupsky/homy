import { getAlertEmoji, extractMessageFromWebhook } from './message-utils.js'

describe('Message Utils', () => {
  describe('getAlertEmoji', () => {
    test('returns correct emojis for actual Grafana alert names', () => {
      // Actual alert names from Grafana configuration
      expect(getAlertEmoji('Термопомпа не работи (Webhook)')).toBe('🌡️')
      expect(getAlertEmoji('Термопомпа претоварване (Webhook)')).toBe('🌡️')
      expect(getAlertEmoji('AC alert (Webhook)')).toBe('🔌')
      expect(getAlertEmoji('Main Power alert (Webhook)')).toBe('⚡')
      expect(getAlertEmoji('Water pump power alert (Webhook)')).toBe('💧')
      expect(getAlertEmoji('Миялна (Webhook)')).toBe('🍽️')
    })

    test('returns water emoji for Bulgarian water alerts', () => {
      expect(getAlertEmoji('Цисла вода')).toBe('💧')
      expect(getAlertEmoji('цисла')).toBe('💧')
      expect(getAlertEmoji('Алармa за водната помпа')).toBe('💧')
    })

    test('returns red circle for Bulgarian signal alerts', () => {
      expect(getAlertEmoji('Сигла')).toBe('🔴')
      expect(getAlertEmoji('сигла температура')).toBe('🔴')
    })

    test('returns thermometer emoji for heat pump and temperature alerts', () => {
      expect(getAlertEmoji('Термопомпа')).toBe('🌡️')
      expect(getAlertEmoji('heat pump failure')).toBe('🌡️')
      expect(getAlertEmoji('High Temperature')).toBe('🌡️')
      expect(getAlertEmoji('temperature sensor')).toBe('🌡️')
    })

    test('returns lightning emoji for power alerts', () => {
      expect(getAlertEmoji('Power Failure')).toBe('⚡')
      expect(getAlertEmoji('power outage')).toBe('⚡')
      expect(getAlertEmoji('Main Power alert')).toBe('⚡')
    })

    test('returns water emoji for water/pump alerts', () => {
      expect(getAlertEmoji('Water Level High')).toBe('💧')
      expect(getAlertEmoji('pump failure')).toBe('💧')
      expect(getAlertEmoji('Water pump power alert')).toBe('💧')
    })

    test('returns plug emoji for AC/voltage alerts', () => {
      expect(getAlertEmoji('AC alert')).toBe('🔌')
      expect(getAlertEmoji('AC Voltage')).toBe('🔌')
      expect(getAlertEmoji('voltage drop')).toBe('🔌')
    })

    test('returns dishwasher emoji for dishwasher alerts', () => {
      expect(getAlertEmoji('Миялна')).toBe('🍽️')
      expect(getAlertEmoji('dishwasher')).toBe('🍽️')
      expect(getAlertEmoji('Dishwasher finished')).toBe('🍽️')
    })

    test('returns wind emoji for humidity alerts', () => {
      expect(getAlertEmoji('High Humidity')).toBe('💨')
      expect(getAlertEmoji('humidity sensor')).toBe('💨')
    })

    test('returns warning emoji for unknown alerts', () => {
      expect(getAlertEmoji('Unknown Alert')).toBe('⚠️')
      expect(getAlertEmoji('Random Alert Name')).toBe('⚠️')
      expect(getAlertEmoji('')).toBe('⚠️')
    })

    test('handles case insensitive matching', () => {
      expect(getAlertEmoji('POWER')).toBe('⚡')
      expect(getAlertEmoji('Power')).toBe('⚡')
      expect(getAlertEmoji('pOwEr')).toBe('⚡')
      expect(getAlertEmoji('ТЕРМОПОМПА')).toBe('🌡️')
    })
  })

  describe('extractMessageFromWebhook', () => {
    test('extracts message from Grafana webhook with single alert', () => {
      const webhookData = {
        status: 'firing',
        receiver: 'telegram-alerts',
        alerts: [{
          labels: {
            alertname: 'High Temperature',
            rule_uid: 'temp-rule-123'
          },
          annotations: {
            message: 'Temperature is above 30°C',
            description: 'Server room temperature critical'
          },
          generatorURL: 'http://grafana.example.com/alerting/rule/123'
        }]
      }

      const result = extractMessageFromWebhook(webhookData)

      expect(result).toMatchInlineSnapshot(`
"🚨 Temperature is above 30°C
"
`)
    })

    test('extracts message from Grafana webhook with multiple alerts', () => {
      const webhookData = {
        status: 'resolved',
        receiver: 'critical-alerts',
        alerts: [
          {
            labels: { alertname: 'Power Issue' },
            annotations: { message: 'Power restored' }
          },
          {
            labels: { alertname: 'Water Level' },
            annotations: { message: 'Water level normal' }
          }
        ]
      }

      const result = extractMessageFromWebhook(webhookData)

      expect(result).toMatchInlineSnapshot(`
"✅ Power restored

✅ Water level normal
"
`)
    })

    test('handles alerts with missing optional fields', () => {
      const webhookData = {
        alerts: [{
          labels: {},
          annotations: {}
        }]
      }

      const result = extractMessageFromWebhook(webhookData)

      expect(result).toMatchInlineSnapshot(`
"🚨 <b>Unknown Alert</b>
"
`)
    })

    test('handles alerts using summary instead of alertname', () => {
      const webhookData = {
        alerts: [{
          labels: { rule_uid: 'test-rule' },
          annotations: {
            summary: 'Summary Alert Name',
            description: 'Alert description'
          }
        }]
      }

      const result = extractMessageFromWebhook(webhookData)

      expect(result).toMatchInlineSnapshot(`
"🚨 <b>Summary Alert Name</b>
Alert description"
`)
    })

    test('extracts message from simple message object', () => {
      const webhookData = {
        message: 'Simple test message'
      }

      const result = extractMessageFromWebhook(webhookData)
      expect(result).toBe('Simple test message')
    })

    test('extracts message from text field object', () => {
      const webhookData = {
        text: 'Text field message'
      }

      const result = extractMessageFromWebhook(webhookData)
      expect(result).toBe('Text field message')
    })

    test('handles raw string input', () => {
      const webhookData = 'Raw string message'

      const result = extractMessageFromWebhook(webhookData)
      expect(result).toBe('Raw string message')
    })

    test('handles unknown object format by stringifying', () => {
      const webhookData = {
        unknown: 'field',
        custom: { nested: 'object' }
      }

      const result = extractMessageFromWebhook(webhookData)

      expect(result).toMatchInlineSnapshot(`
"Webhook received:

{
  "unknown": "field",
  "custom": {
    "nested": "object"
  }
}"
`)
    })

    test('prioritizes message field over text field', () => {
      const webhookData = {
        message: 'Message field content',
        text: 'Text field content'
      }

      const result = extractMessageFromWebhook(webhookData)
      expect(result).toBe('Message field content')
    })

    test('uses description when message annotation is missing', () => {
      const webhookData = {
        alerts: [{
          labels: { alertname: 'Test Alert' },
          annotations: { description: 'Description content' }
        }]
      }

      const result = extractMessageFromWebhook(webhookData)
      expect(result).toMatchInlineSnapshot(`
"🚨 <b>Test Alert</b>
Description content"
`)
    })
  })
})
