#!/usr/bin/env node
/* eslint-env node */
// TEST: Temporary change to verify CI workflow handles service-only changes
const mqtt = require('mqtt')
const resolve = require('./lib/resolve')
const StateManager = require('./lib/state-manager')

const {
  bots: botConfigs,
  gates: {
    mqtt: {
      url: mqttUrl = 'mqtt://localhost',
      clientId: mqttClientId = 'homy-automations'
    },
    state: {
      enabled = false,
      dir: stateDir = process.env.STATE_DIR || '/app/state',
      debounceMs: stateDebounceMs = 100
    } = {}
  }
} = require(process.env.CONFIG || './config')

const stateManager = new StateManager({enabled, stateDir, debounceMs: stateDebounceMs})

const playground = {
  bots: Object.entries(botConfigs).map(([name, config]) => {
    console.log(`[${config.type}] loading ${name}`)
    return {
      config,
      name,
      hooks: resolve({ name: config.type, params: [name, config] }, 'bots')
    }
  }),
  gates: {
    mqtt: mqtt.connect(mqttUrl, {
      clientId: mqttClientId
    }),
    state: stateManager
  }
}

const contentProcessors = require('./lib/content-processors')

playground.gates.mqtt.setMaxListeners(1000)
const mqttSubscriptions = {}
playground.gates.mqtt.on('connect', () => {
    console.log('Connected to MQTT broker at', mqttUrl)
})
playground.gates.mqtt.on('reconnect', () => {
    console.log('Reconnecting to MQTT broker at', mqttUrl)
})
playground.gates.mqtt.on('disconnect', () => {
    console.log('Disconnected from MQTT broker at', mqttUrl)
})
playground.gates.mqtt.on('close', () => {
    console.log('Connection to MQTT broker closed', mqttUrl)
})
playground.gates.mqtt.on('offline', () => {
    console.log('MQTT broker offline', mqttUrl)
})
playground.gates.mqtt.on('error', (err) => {
    console.error('MQTT error', err)
})
playground.gates.mqtt.on('message', (msgTopic, payload) => {
  if (!mqttSubscriptions[msgTopic]) {
    console.warn('No handler for topic', msgTopic)
    return
  }

  const payloadJson = JSON.parse(payload.toString())
  for (const subscription of mqttSubscriptions[msgTopic]) {
    try {
      subscription(payloadJson)
    } catch (err) {
      console.error('Error in subscription handler for topic', msgTopic, err)
    }
  }
})

playground.bots.forEach(async bot => {
  console.log(`[${bot.config.type}] starting ${bot.name}`)

  // Initialize bot control state with persistence
  const controlStateKey = `${bot.name}__control`
  const defaultControlState = {
    enabled: typeof bot.config.enabled === 'boolean' ? bot.config.enabled : true
  }
  const controlState = await playground.gates.state.createBotState(
    controlStateKey,
    defaultControlState,
    1, // version
    null // no migration needed
  )

  // Use reactive state for enabled
  bot.enabled = controlState.enabled

  // Publish bot status
  const publishBotStatus = () => {
    const statusTopic = `homy/automation/${bot.name}/status`
    playground.gates.mqtt.publish(statusTopic, JSON.stringify({
      enabled: bot.enabled,
      type: bot.config.type,
      _tz: Date.now()
    }), { retain: true }, (err) => {
      if (err) {
        console.error(`[${bot.config.type}] failure publishing status to ${statusTopic}`, err)
      }
    })
  }

  // Subscribe to control topic for enable/disable
  const controlTopic = `homy/automation/${bot.name}/control`
  playground.gates.mqtt.subscribe(controlTopic, (err) => {
    if (err) {
      console.error(`[${bot.config.type}] failure subscribing to control topic ${controlTopic}`, err)
    } else {
      console.log(`[${bot.config.type}] subscribed to control topic ${controlTopic}`)
    }
  })

  // Add control topic to subscriptions
  if (!mqttSubscriptions[controlTopic]) {
    mqttSubscriptions[controlTopic] = []
  }
  mqttSubscriptions[controlTopic].push((payload) => {
    const enabled = payload.enabled
    if (typeof enabled === 'boolean' && bot.enabled !== enabled) {
      bot.enabled = enabled
      controlState.enabled = enabled // Persist the change
      console.log(`[${bot.config.type}] ${bot.name} ${enabled ? 'enabled' : 'disabled'}`)
      publishBotStatus()
    }
  })

  // Publish initial status
  publishBotStatus()

  const startParams = {
    mqtt: {
      subscribe: async (topic, cb) => new Promise((resolve, reject) => {
        console.log(`[${bot.config.type}] subscribing to ${topic}`)
        if (mqttSubscriptions[topic]) {
          // Wrap callback to check enabled state
          const wrappedCb = (payload) => {
            if (bot.enabled) {
              cb(payload)
            }
          }
          mqttSubscriptions[topic].push(wrappedCb)
          resolve()
        } else {
          // Wrap callback to check enabled state
          const wrappedCb = (payload) => {
            if (bot.enabled) {
              cb(payload)
            }
          }
          mqttSubscriptions[topic] = [wrappedCb]
          playground.gates.mqtt.subscribe(topic, (err) => {
            if (err) {
              console.error(`[${bot.config.type}] failure subscribing to ${topic}`, err)
              reject(err)
              return
            }
            resolve()
          })
        }
      }),
      publish: async (topic, payload, {
        content = 'json',
        qos = 0,
        retain = false,
      } = {}) => {
        // Check if bot is enabled before publishing
        if (!bot.enabled) {
          console.log(`[${bot.config.type}] ${bot.name} is disabled, skipping publish to ${topic}`)
          return
        }
        if (!contentProcessors[content]?.write) {
          throw new Error(`Missing ${content} write transformation!`)
        }
        const writer = contentProcessors[content].write
        const meta = {
          _bot: {
            name: bot.name,
            type: bot.config.type
          },
          _tz: Date.now()
        }
        return new Promise((resolve, reject) => playground.gates.mqtt.publish(topic, writer(payload, meta), { qos, retain }, (err) => {
          if (err) {
            console.error(`[${bot.config.type}] failure sending to ${topic}`, payload)
            reject(err)
            return
          }
          resolve()
        }))
      }
    }
  }

  if (bot.hooks.persistedCache) {
    const { version = 1, default: defaultState = {}, migrate } = bot.hooks.persistedCache
    startParams.persistedCache = await playground.gates.state.createBotState(bot.name, defaultState, version, migrate)
  } else {
    // Provide warning getter to catch accidental usage
    Object.defineProperty(startParams, 'persistedCache', {
      get() {
        console.warn(`[${bot.name}] Attempted to access persistedCache but bot.persistedCache not configured. Changes will not persist!`)
        return null
      },
      enumerable: false
    })
  }

  bot.hooks.start(startParams)
})

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, cleaning up...')
  await Promise.all([
    playground.gates.mqtt.endAsync(),
    playground.gates.state.cleanup()
  ])
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('Received SIGINT, cleaning up...')
  await Promise.all([
    playground.gates.mqtt.endAsync(),
    playground.gates.state.cleanup()
  ])
  process.exit(0)
})
