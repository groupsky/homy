#!/usr/bin/env node
const KafkaBridge = require('./kafka-bridge')

function getFileEnv(envVariable) {
  const origVar = process.env[envVariable];
  const fileVar = process.env[envVariable + '_FILE'];
  if (fileVar) {
    const fs = require('fs');
    try {
      if (fs.existsSync(fileVar)) {
        return fs.readFileSync(fileVar).toString().split(/\r?\n/)[0].trim();
      }
    } catch (err) {
      console.error('Failed to read file', fileVar, err);
    }
  }
  return origVar;
}

const config = {
  mqttUrl: process.env.BROKER || 'mqtt://localhost',
  kafkaHosts: (process.env.KAFKA_HOSTS || 'kafka:9092').split(','),
  clientId: process.env.MQTT_CLIENT_ID || 'kafka-bridge'
}

console.log('Starting Kafka Bridge with config:', {
  ...config,
  kafkaHosts: config.kafkaHosts.join(',')
})

const bridge = new KafkaBridge(config)

bridge.start()
  .then(() => console.log('Kafka Bridge started successfully'))
  .catch(err => {
    console.error('Failed to start Kafka Bridge:', err)
    process.exit(1)
  })

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down Kafka Bridge...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Shutting down Kafka Bridge...')
  process.exit(0)
})