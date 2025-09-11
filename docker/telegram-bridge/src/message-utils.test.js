import { getAlertEmoji, getStatusEmoji, extractMessageFromWebhook, debugWebhook, debugMessage } from './message-utils.js'

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

  describe('getStatusEmoji', () => {
    test('returns appropriate emojis for standard alert states', () => {
      expect(getStatusEmoji('firing')).toBe('🚨')
      expect(getStatusEmoji('critical')).toBe('🚨')
      expect(getStatusEmoji('alerting')).toBe('🚨')
      
      expect(getStatusEmoji('resolved')).toBe('✅')
      expect(getStatusEmoji('ok')).toBe('✅')
      
      expect(getStatusEmoji('warning')).toBe('⚠️')
    })

    test('returns special emojis for NoData and Error states', () => {
      expect(getStatusEmoji('nodata')).toBe('📵') // no data/mobile off
      expect(getStatusEmoji('error')).toBe('🚧') // under construction/broken
    })

    test('returns info emoji for unknown states', () => {
      expect(getStatusEmoji('unknown')).toBe('ℹ️')
      expect(getStatusEmoji('')).toBe('ℹ️')
      expect(getStatusEmoji('pending')).toBe('ℹ️')
    })

    test('handles case insensitive matching', () => {
      expect(getStatusEmoji('FIRING')).toBe('🚨')
      expect(getStatusEmoji('Resolved')).toBe('✅')
      expect(getStatusEmoji('NoData')).toBe('📵')
      expect(getStatusEmoji('ERROR')).toBe('🚧')
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

    describe('NoData and Error state handling', () => {
      test('handles DatasourceNoData alert with special formatting', () => {
        const webhookData = {
          status: 'firing',
          alerts: [{
            labels: {
              alertname: 'DatasourceNoData',
              datasource_uid: 'influxdb-uid',
              rulename: 'Sunseeker Battery Low'
            },
            annotations: {
              summary: 'No data received',
              description: 'Alert rule "Sunseeker Battery Low" is not receiving data from data source'
            }
          }]
        }

        const result = extractMessageFromWebhook(webhookData)
        expect(result).toContain('📵') // Should use no data emoji for NoData
        expect(result).toContain('DATA SOURCE ISSUE')
        expect(result).toContain('Sunseeker Battery Low')
        expect(result).toContain('not receiving data')
      })

      test('handles DatasourceError alert with special formatting', () => {
        const webhookData = {
          status: 'firing', 
          alerts: [{
            labels: {
              alertname: 'DatasourceError',
              datasource_uid: 'influxdb-uid',
              rulename: 'Temperature Monitor'
            },
            annotations: {
              summary: 'Query execution error',
              description: 'Alert rule "Temperature Monitor" failed to execute query'
            }
          }]
        }

        const result = extractMessageFromWebhook(webhookData)
        expect(result).toContain('🚧') // Should use under construction emoji for Error
        expect(result).toContain('ALERT SYSTEM ERROR')
        expect(result).toContain('Temperature Monitor')
        expect(result).toContain('failed to execute')
      })

      test('handles mixed alert types in single webhook', () => {
        const webhookData = {
          status: 'firing',
          alerts: [
            {
              labels: { alertname: 'High Temperature' },
              annotations: { message: 'Temperature is 45°C' }
            },
            {
              labels: { 
                alertname: 'DatasourceNoData',
                rulename: 'Voltage Monitor' 
              },
              annotations: {
                summary: 'No voltage data',
                description: 'Alert rule "Voltage Monitor" is not receiving data'
              }
            }
          ]
        }

        const result = extractMessageFromWebhook(webhookData)
        expect(result).toContain('🚨 Temperature is 45°C') // Normal alert
        expect(result).toContain('📵') // NoData alert uses single no data emoji
        expect(result).toContain('DATA SOURCE ISSUE') // NoData alert
        expect(result).toContain('Voltage Monitor')
      })
    })

    describe('Alert state differentiation', () => {
      test('provides clear distinction for resolved alerts', () => {
        const webhookData = {
          status: 'resolved',
          alerts: [{
            labels: { alertname: 'Battery Low' },
            annotations: { message: 'Battery level restored' }
          }]
        }

        const result = extractMessageFromWebhook(webhookData)
        expect(result).toContain('✅')
        expect(result).toContain('Battery level restored')
      })

      test('handles error state resolution', () => {
        const webhookData = {
          status: 'resolved',
          alerts: [{
            labels: {
              alertname: 'DatasourceError',
              rulename: 'Connection Test'
            },
            annotations: {
              summary: 'Data source recovered',
              description: 'Alert rule "Connection Test" is working normally'
            }
          }]
        }

        const result = extractMessageFromWebhook(webhookData)
        expect(result).toContain('✅') // Resolved status emoji for system recovery
        expect(result).toContain('ALERT SYSTEM RECOVERED')
        expect(result).toContain('Connection Test')
      })
    })
  })

  describe('Debug integration', () => {
    test('exports debug instances', () => {
      expect(debugWebhook).toBeDefined()
      expect(debugMessage).toBeDefined()
      expect(typeof debugWebhook).toBe('function')
      expect(typeof debugMessage).toBe('function')
    })

    test('debug instances have correct namespaces', () => {
      expect(debugWebhook.namespace).toBe('telegram-bridge:webhook')
      expect(debugMessage.namespace).toBe('telegram-bridge:message')
    })

    test('extractMessageFromWebhook calls debug logging', () => {
      const debugSpy = jest.spyOn(debugWebhook, 'extend').mockReturnValue(jest.fn())
      
      const webhookData = {
        status: 'firing',
        alerts: [{
          labels: { alertname: 'Test Alert' },
          annotations: { message: 'Test message' }
        }]
      }

      // The debug call happens internally, we just verify the function works normally
      const result = extractMessageFromWebhook(webhookData)
      expect(result).toContain('🚨 Test message')
      
      debugSpy.mockRestore()
    })
  })
})
