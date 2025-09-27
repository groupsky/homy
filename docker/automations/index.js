#!/usr/bin/env node
/* eslint-env node */
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

const contentProcessors = {
  json: {
    read: (val) => JSON.parse(val),
    write: (val) => JSON.stringify(val),
  },
  plain: {
    read: (val) => String(val),
    write: (val) => String(val),
  }
}

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

  const startParams = {
    mqtt: {
      subscribe: async (topic, cb) => new Promise((resolve, reject) => {
        console.log(`[${bot.config.type}] subscribing to ${topic}`)
        if (mqttSubscriptions[topic]) {
          mqttSubscriptions[topic].push(cb)
          resolve()
        } else {
          mqttSubscriptions[topic] = [cb]
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
        if (!contentProcessors[content]?.write) {
          throw new Error(`Missing ${content} write transformation!`)
        }
        const writer = contentProcessors[content].write
        return new Promise((resolve, reject) => playground.gates.mqtt.publish(topic, writer({
          ...payload,
          _bot: {
            name: bot.name,
            type: bot.config.type
          },
          _tz: Date.now()
        }), { qos, retain }, (err) => {
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
