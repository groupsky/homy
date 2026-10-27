// Publishes one retained message to the MQTT broker: MQTT 3.1.1 CONNECT,
// PUBLISH with QoS 1 and the retain flag, wait for the PUBACK, DISCONNECT.
// The service sends one small message every 15 minutes, so a short
// connection each time is enough, and it keeps the service free of npm
// dependencies.
import { connect } from 'node:net'

const CONNECT = 1
const CONNACK = 2
const PUBLISH = 3
const PUBACK = 4
const DISCONNECT = 14
const PACKET_ID = 1
const KEEPALIVE_S = 30

// The MQTT "remaining length": 7 bits a byte, the high bit set when more follow.
export function encodeLength (length) {
  const bytes = []
  do {
    let byte = length % 128
    length = Math.floor(length / 128)
    if (length > 0) byte |= 0x80
    bytes.push(byte)
  } while (length > 0)
  return Buffer.from(bytes)
}

const string = (text) => {
  const bytes = Buffer.from(text, 'utf8')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length)
  return Buffer.concat([length, bytes])
}

const packet = (header, body) => Buffer.concat([Buffer.from([header]), encodeLength(body.length), body])

function connectPacket (clientId) {
  // protocol "MQTT", level 4 (3.1.1), flags: clean session, keepalive
  const header = Buffer.concat([string('MQTT'), Buffer.from([4, 0x02, 0, KEEPALIVE_S])])
  return packet(CONNECT << 4, Buffer.concat([header, string(clientId)]))
}

function publishPacket (topic, payload) {
  const id = Buffer.from([0, PACKET_ID])
  // QoS 1 (0b010) and retain (0b001)
  return packet((PUBLISH << 4) | 0b0011, Buffer.concat([string(topic), id, Buffer.from(payload, 'utf8')]))
}

// Resolves once the broker has acknowledged the message; rejects on a refused
// connection, a socket error or no answer within `timeoutMs`.
export function publishRetained ({ host, port, clientId, timeoutMs = 10000 }, topic, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    let buffer = Buffer.alloc(0)
    const done = (err) => {
      clearTimeout(timer)
      if (err) socket.destroy()
      else socket.end(packet(DISCONNECT << 4, Buffer.alloc(0)))
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => done(new Error(`MQTT publish to ${host}:${port} timed out`)), timeoutMs)
    socket.on('error', (err) => done(new Error(`MQTT publish to ${host}:${port}: ${err.message}`)))
    socket.on('connect', () => socket.write(connectPacket(clientId)))
    // Both answers are 4 bytes: type, length 2, then 2 bytes.
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      while (buffer.length >= 4) {
        const type = buffer[0] >> 4
        const answer = buffer.subarray(0, 4)
        buffer = buffer.subarray(4)
        if (type === CONNACK) {
          if (answer[3] !== 0) return done(new Error(`MQTT connection refused: ${answer[3]}`))
          socket.write(publishPacket(topic, payload))
        } else if (type === PUBACK && answer.readUInt16BE(2) === PACKET_ID) {
          return done()
        }
      }
    })
  })
}
