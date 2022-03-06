#!/usr/bin/env node
/* eslint-env node */
const mqtt = require('mqtt')
const resolve = require('./lib/resolve')

const {
  bots: botConfigs,
  gates: {
    mqtt: {
      url: mqttUrl = 'mqtt://localhost',
      clientId: mqttClientId = 'homy-automations'
    }
  }
} = require(process.env.CONFIG || './config')

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
    })
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

playground.bots.forEach(bot => {
  console.log(`[${bot.config.type}] starting ${bot.name}`)
  bot.hooks.start({
    mqtt: {
      subscribe: async (topic, cb) => new Promise((resolve, reject) => {
        playground.gates.mqtt.on('connect', () => {
          playground.gates.mqtt.subscribe(topic, (err) => {
            if (err) {
              console.error(`[${bot.config.type}] failure subscribing to ${topic}`, err)
              reject(err)
              return
            }
            resolve()
          })
          playground.gates.mqtt.on('message', (msgTopic, payload) => {
            if (topic !== msgTopic) {
              return
            }

            cb(JSON.parse(payload.toString()))
          })
        })
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
  })
})
