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
    console.log(`loading ${name}: ${config.type}`)
    return require(`./bots/${config.type}`)(name, config)
  }),
  gates: {
    mqtt: mqtt.connect(mqttUrl, {
      clientId: mqttClientId
    })
  }
}

console.log('starting bots')
playground.bots.forEach(bot => bot.start(playground))
