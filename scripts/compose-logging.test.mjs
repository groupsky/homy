// Every service in docker-compose.yml must take its log rotation from the
// shared `x-logging` anchor, so no container can grow an unbounded log.
// Reads the file as text (no YAML dependency) so it runs with plain `node --test`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8').split('\n')

// Names of the services and the lines that belong to each of them.
function services (lines) {
  const start = lines.findIndex((l) => l === 'services:')
  assert.notEqual(start, -1, 'no top-level services: key')
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l))
  const found = new Map()
  let current = null
  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    const name = line.match(/^ {2}([A-Za-z0-9_.-]+):(\s*&\S+)?\s*$/)
    if (name) {
      current = []
      found.set(name[1], current)
    } else if (current) {
      current.push(line)
    }
  }
  return found
}

test('x-logging anchor rotates the json-file log', () => {
  const at = compose.findIndex((l) => l === 'x-logging: &default-logging')
  assert.notEqual(at, -1, 'x-logging: &default-logging is missing')
  const body = compose.slice(at + 1, at + 5).join('\n')
  assert.match(body, /max-size: "?\d+[kmg]"?/)
  assert.doesNotMatch(body, /driver:/)
  assert.match(body, /max-file: "?[1-9]\d*"?/)
})

test('every service uses the shared logging anchor', () => {
  const all = services(compose)
  assert.ok(all.size > 0)
  const missing = [...all].filter(([, body]) => !body.includes('    logging: *default-logging')).map(([name]) => name)
  assert.deepEqual(missing, [], `services without "logging: *default-logging": ${missing.join(', ')}`)
})
