import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { publishRetained, encodeLength } from './mqtt.js'

// A fake MQTT broker: answers CONNECT with `connackCode` and a QoS 1
// PUBLISH with a PUBACK, and keeps the packets it got.
function fakeBroker ({ connackCode = 0, puback = true } = {}) {
  const packets = []
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0)
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        if (buffer.length < 2) return
        let length = 0
        let multiplier = 1
        let i = 1
        let byte
        do {
          byte = buffer[i++]
          length += (byte & 0x7f) * multiplier
          multiplier *= 128
        } while (byte & 0x80)
        if (buffer.length < i + length) return
        const packet = { type: buffer[0] >> 4, flags: buffer[0] & 0x0f, body: buffer.subarray(i, i + length) }
        buffer = buffer.subarray(i + length)
        packets.push(packet)
        if (packet.type === 1) socket.write(Buffer.from([0x20, 0x02, 0x00, connackCode]))
        if (packet.type === 3 && puback) {
          const topicLength = packet.body.readUInt16BE(0)
          socket.write(Buffer.concat([Buffer.from([0x40, 0x02]), packet.body.subarray(2 + topicLength, 4 + topicLength)]))
        }
      }
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, packets, port: server.address().port })))
}

test('encodeLength uses the MQTT variable length', () => {
  assert.deepEqual([...encodeLength(0)], [0])
  assert.deepEqual([...encodeLength(127)], [0x7f])
  assert.deepEqual([...encodeLength(128)], [0x80, 0x01])
  assert.deepEqual([...encodeLength(16384)], [0x80, 0x80, 0x01])
})

test('publishRetained connects, publishes one retained QoS 1 message and disconnects', async () => {
  const { server, packets, port } = await fakeBroker()
  try {
    const payload = JSON.stringify({ text: 'Зареждания', filler: 'x'.repeat(300) })
    await publishRetained({ host: '127.0.0.1', port, clientId: 'energy-report' }, 'homy/ioniq/charges', payload)
    // the DISCONNECT is sent after the PUBACK, so it may arrive a moment later
    while (packets.length < 3) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual(packets.map((p) => p.type), [1, 3, 14])
    const connect = packets[0].body
    assert.equal(connect.subarray(2, 6).toString(), 'MQTT')
    assert.equal(connect[6], 4) // MQTT 3.1.1
    assert.equal(connect.subarray(12).toString(), 'energy-report')
    const publish = packets[1]
    assert.equal(publish.flags, 0b0011) // QoS 1, retain
    const topicLength = publish.body.readUInt16BE(0)
    assert.equal(publish.body.subarray(2, 2 + topicLength).toString(), 'homy/ioniq/charges')
    assert.equal(publish.body.subarray(4 + topicLength).toString(), payload)
  } finally {
    server.close()
  }
})

test('publishRetained fails when the broker refuses the connection', async () => {
  const { server, port } = await fakeBroker({ connackCode: 5 })
  try {
    await assert.rejects(publishRetained({ host: '127.0.0.1', port, clientId: 'x' }, 't', '{}'), /refused: 5/)
  } finally {
    server.close()
  }
})

test('publishRetained fails when the broker does not answer in time', async () => {
  const { server, port } = await fakeBroker({ puback: false })
  try {
    await assert.rejects(publishRetained({ host: '127.0.0.1', port, clientId: 'x', timeoutMs: 200 }, 't', '{}'), /timed out/)
  } finally {
    server.close()
  }
})

test('publishRetained fails when the broker is away', async () => {
  const { server, port } = await fakeBroker()
  await new Promise((resolve) => server.close(resolve))
  await assert.rejects(publishRetained({ host: '127.0.0.1', port, clientId: 'x' }, 't', '{}'))
})
