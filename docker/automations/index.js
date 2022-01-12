#!/usr/bin/env node
/* eslint-env node */
const mqtt = require('mqtt')
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
      hooks: require(`./bots/${config.type}`)(name, config)
    }
  }),
  gates: {
    mqtt: mqtt.connect(mqttUrl, {
      clientId: mqttClientId
    })
  }
}

playground.gates.mqtt.setMaxListeners(1000)

playground.bots.forEach(bot => {
  console.log(`[${bot.config.type}] starting ${bot.name}`)
  bot.hooks.start({
    mqtt: {
      subscribe: (topic, cb) => {
        playground.gates.mqtt.on('connect', () => {
          playground.gates.mqtt.subscribe(topic, (err) => {
            if (err) {
              console.error(`[${bot.config.type}] failure subscribing to ${topic}`, err)
              return
            }
          })
          playground.gates.mqtt.on('message', (msgTopic, payload) => {
            if (topic !== msgTopic) {
              return
            }

            cb(JSON.parse(payload.toString()))
          })
        })
      },
      publish: (topic, payload) => {
        playground.gates.mqtt.publish(topic, JSON.stringify({
          ...payload,
          _bot: {
            name: bot.name,
            type: bot.config.type
          },
          _tz: Date.now()
        }), (err) => {
          if (err) {
            console.error(`[${bot.config.type}] failure sending to ${topic}`, payload)
            return
          }
        })
      }
    }
  })
})