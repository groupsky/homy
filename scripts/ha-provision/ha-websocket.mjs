// A minimal client for the Home Assistant websocket API, shared by the
// scripts that talk to HA with an admin token.
import { readFileSync } from 'node:fs'

export function readToken (file) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    throw new Error(`mount a long-lived access token of an admin user at ${file}`)
  }
}

export function connect (url, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    const client = {
      call: (message) => new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { res, rej, type: message.type })
        ws.send(JSON.stringify({ id, ...message }))
      }),
      close: () => ws.close()
    }
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }))
      } else if (message.type === 'auth_ok') {
        resolve(client)
      } else if (message.type === 'auth_invalid') {
        reject(new Error(`authentication rejected: ${message.message}`))
      } else if (message.type === 'result' && pending.has(message.id)) {
        const { res, rej, type } = pending.get(message.id)
        pending.delete(message.id)
        if (message.success) res(message.result)
        else rej(new Error(`${type} failed: ${message.error?.code} ${message.error?.message}`))
      }
    })
    ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)))
    ws.addEventListener('close', () => {
      for (const { rej, type } of pending.values()) rej(new Error(`${type}: connection closed`))
      pending.clear()
    })
  })
}
