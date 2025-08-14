const kafka = require('kafka-node')
const baseBathLights = require('./bath-lights')

/**
 * Event-sourced Bath lights automation
 * Extends the base bath-lights bot with event sourcing capabilities
 * @param {string} name
 * @param {{
 *   statusTopic: string,
 *   commandTopic: string,
 *   statusTopic: string,
 *   commandTopic: string,
 *   kafka: {hosts: string[], eventsTopicPrefix: string},
 *   ...baseConfig
 * }} config
 */
module.exports = (name, config) => {
  let kafkaProducer = null
  let kafkaConsumer = null
  let currentState = {
    door: null,
    light: null,
    lock: null,
    toggle: null
  }
  let eventStore = []

  const kafkaConfig = config.kafka || {
    hosts: ['kafka:9092'],
    eventsTopicPrefix: 'homy.events'
  }

  const eventTopic = `${kafkaConfig.eventsTopicPrefix}.${name}`

  const publishEvent = async (eventType, data, metadata = {}) => {
    const event = {
      eventType,
      aggregateId: name,
      timestamp: Date.now(),
      data,
      metadata: {
        source: 'automation',
        ...metadata
      }
    }

    eventStore.push(event)

    if (kafkaProducer) {
      return new Promise((resolve, reject) => {
        kafkaProducer.send([{
          topic: eventTopic,
          messages: [{
            key: `${name}.${eventType}`,
            value: JSON.stringify(event)
          }]
        }], (err, result) => {
          if (err) reject(err)
          else resolve(result)
        })
      })
    }
  }

  const connectKafka = async () => {
    const client = new kafka.KafkaClient({ kafkaHost: kafkaConfig.hosts.join(',') })
    
    kafkaProducer = new kafka.Producer(client)
    
    await new Promise((resolve, reject) => {
      kafkaProducer.on('ready', resolve)
      kafkaProducer.on('error', reject)
    })

    // Create consumer for event replay/restoration
    kafkaConsumer = new kafka.Consumer(client, [
      { topic: eventTopic, partition: 0, offset: 0 }
    ], {
      autoCommit: false,
      fromOffset: 'earliest'
    })

    kafkaConsumer.on('message', (message) => {
      try {
        const event = JSON.parse(message.value)
        if (event.aggregateId === name) {
          applyEvent(event)
        }
      } catch (err) {
        console.error('Error processing Kafka message:', err)
      }
    })
  }

  const applyEvent = (event) => {
    switch (event.eventType) {
      case 'door.state.changed':
        currentState.door = event.data.state
        break
      case 'light.state.changed':
        currentState.light = event.data.state
        break
      case 'lock.state.changed':
        currentState.lock = event.data.state
        break
      case 'toggle.state.changed':
        currentState.toggle = event.data.state
        break
    }
  }

  // Create event-sourced wrapper for the base bot
  const createEventSourcingWrapper = (baseBotInstance) => {
    return {
      async start(context) {
        await connectKafka()
        
        // Wrap MQTT subscribe to publish state change events
        const originalMqtt = context.mqtt
        const wrappedMqtt = {
          ...originalMqtt,
          subscribe: (topic, callback) => {
            const wrappedCallback = async (payload) => {
              // Determine event type from topic
              let eventType = 'unknown.state.changed'
              if (topic === config.light?.statusTopic) {
                eventType = 'light.state.changed'
                await publishEvent(eventType, payload)
              } else if (topic === config.door?.statusTopic) {
                eventType = 'door.state.changed'
                await publishEvent(eventType, payload)
              } else if (topic === config.lock?.statusTopic) {
                eventType = 'lock.state.changed'
                await publishEvent(eventType, payload)
              } else if (topic === config.toggle?.statusTopic) {
                eventType = 'toggle.state.changed'
                await publishEvent(eventType, payload)
              }
              
              callback(payload)
            }
            return originalMqtt.subscribe(topic, wrappedCallback)
          },
          publish: async (topic, payload) => {
            // Publish automation decision event
            if (topic === config.light?.commandTopic) {
              await publishEvent('automation.decision.made', {
                action: payload.state ? 'turn_on_lights' : 'turn_off_lights',
                reason: payload.r || 'unknown',
                lightState: currentState.light,
                inputState: { ...currentState }
              })
            }
            return originalMqtt.publish(topic, payload)
          }
        }

        // Override timer functions to publish timer events
        const originalSetTimeout = global.setTimeout
        const originalClearTimeout = global.clearTimeout
        
        global.setTimeout = (callback, delay) => {
          publishEvent('timer.created', { 
            delay, 
            type: 'timeout',
            reason: 'automation_timer'
          })
          
          const wrappedCallback = () => {
            publishEvent('timeout.triggered', { 
              delay, 
              reason: 'automation_timer'
            })
            callback()
          }
          
          return originalSetTimeout(wrappedCallback, delay)
        }
        
        global.clearTimeout = (timerId) => {
          publishEvent('timer.cancelled', { 
            timerId, 
            reason: 'automation_cancellation'
          })
          return originalClearTimeout(timerId)
        }

        // Start the base bot with wrapped context
        return baseBotInstance.start({ mqtt: wrappedMqtt })
      },

      getCurrentState: () => ({ ...currentState }),

      replayEvents: async (events) => {
        const decisions = []
        let replayState = {
          door: null,
          light: null,
          lock: null,
          toggle: null
        }

        for (const event of events) {
          const inputState = { ...replayState }
          
          // Apply state changes
          switch (event.eventType) {
            case 'door.state.changed':
              replayState.door = event.data.state
              break
            case 'light.state.changed':
              replayState.light = event.data.state
              break
            case 'lock.state.changed':
              replayState.lock = event.data.state
              break
            case 'toggle.state.changed':
              replayState.toggle = event.data.state
              break
            case 'automation.decision.made':
              decisions.push({
                timestamp: event.timestamp,
                action: event.data.action,
                reason: event.data.reason,
                inputState,
                outputState: { ...replayState }
              })
              break
          }
        }

        return {
          finalState: replayState,
          decisions
        }
      },

      close: async () => {
        if (kafkaConsumer) {
          kafkaConsumer.close()
        }
        if (kafkaProducer) {
          // kafkaProducer doesn't have a close method in kafka-node
        }
      }
    }
  }

  // Create base bot instance
  const baseBotInstance = baseBathLights(name, config)
  
  // Return event-sourced wrapper
  return createEventSourcingWrapper(baseBotInstance)
}