const mqtt = require('mqtt')
const kafka = require('kafka-node')

class KafkaBridge {
  constructor(config) {
    this.config = config
    this.mqttClient = null
    this.kafkaProducer = null
  }

  async start() {
    await this.connectMqtt()
    await this.connectKafka()
    this.setupMessageBridging()
  }

  connectMqtt() {
    return new Promise((resolve) => {
      this.mqttClient = mqtt.connect(this.config.mqttUrl, {
        clientId: this.config.clientId
      })

      this.mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker')
        // Subscribe to feature state changes and automation events
        this.mqttClient.subscribe('homy/features/+/+/status')
        this.mqttClient.subscribe('homy/automation/+/state')
        resolve()
      })

      this.mqttClient.on('error', (err) => {
        console.error('MQTT connection error:', err)
      })
    })
  }

  connectKafka() {
    return new Promise((resolve, reject) => {
      const client = new kafka.KafkaClient({ kafkaHost: this.config.kafkaHosts.join(',') })
      this.kafkaProducer = new kafka.Producer(client)

      this.kafkaProducer.on('ready', () => {
        console.log('Connected to Kafka')
        resolve()
      })

      this.kafkaProducer.on('error', (err) => {
        console.error('Kafka connection error:', err)
        reject(err)
      })
    })
  }

  setupMessageBridging() {
    this.mqttClient.on('message', (topic, message) => {
      this.bridgeMessage(topic, message)
        .catch(err => console.error('Error bridging message:', err))
    })
  }

  async bridgeMessage(topic, message) {
    // Only bridge specific message patterns
    if (!this.shouldBridgeMessage(topic)) {
      return
    }

    try {
      const payload = JSON.parse(message.toString())
      const event = this.transformToEvent(topic, payload)
      const kafkaKey = topic.replace(/\//g, '.')

      await this.sendToKafka({
        topic: 'homy.events',
        messages: [{
          key: kafkaKey,
          value: JSON.stringify(event)
        }]
      })
    } catch (err) {
      console.error('Error processing message:', err)
    }
  }

  shouldBridgeMessage(topic) {
    const eventPatterns = [
      /^homy\/features\/[\w-]+\/[\w-]+\/status$/,
      /^homy\/automation\/[\w-]+\/state$/
    ]
    
    return eventPatterns.some(pattern => pattern.test(topic))
  }

  transformToEvent(topic, payload) {
    const timestamp = Date.now()
    
    // Remove internal metadata from data
    const { _bot, _tz, ...data } = payload
    
    if (topic.startsWith('homy/features/')) {
      const parts = topic.split('/')
      const type = parts[2]
      const name = parts[3]
      
      return {
        eventType: 'feature.state.changed',
        aggregateId: `${type}.${name}`,
        timestamp,
        data,
        metadata: {
          source: 'mqtt',
          originalTopic: topic
        }
      }
    }
    
    if (topic.startsWith('homy/automation/')) {
      const parts = topic.split('/')
      const automationType = parts[2]
      const botName = _bot ? _bot.name : 'unknown'
      
      return {
        eventType: 'automation.state.changed',
        aggregateId: `${automationType}.${botName}`,
        timestamp,
        data,
        metadata: {
          source: 'mqtt',
          originalTopic: topic,
          ..._bot && { bot: _bot }
        }
      }
    }
    
    throw new Error(`Unknown topic pattern: ${topic}`)
  }

  sendToKafka(payload) {
    return new Promise((resolve, reject) => {
      this.kafkaProducer.send([payload], (err, result) => {
        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      })
    })
  }
}

module.exports = KafkaBridge