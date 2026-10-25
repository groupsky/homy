const { describe, expect, it } = require('@jest/globals')
const path = require('path')

const configDir = path.resolve(__dirname, '../../config/automations')

const load = () => require(path.join(configDir, 'ha_discovery.js')).bots

// What Home Assistant uses to keep an entity: the registry matches on
// unique_id, and the entity_id comes from default_entity_id (object_id).
// These must never change, only the shown name may (#1842).
const identity = (bots) => Object.fromEntries(Object.entries(bots).map(([key, bot]) => {
  const p = bot.input.params.payload
  return [key, {
    unique_id: p.unique_id,
    object_id: p.object_id,
    default_entity_id: p.default_entity_id,
    discovery_topic: bot.output.params.topic,
    state_topic: p.state_topic,
    command_topic: p.command_topic,
    device: p.device && p.device.identifiers,
  }]
}))

// SHA-256 of the identity of every entity, taken from ha_discovery.js before
// the names were changed (commit a8846ef). A hash and not the list itself,
// because the topics hold room names that must not be copied into new files.
// If this test fails, print canonical(identity(load())) here and for the
// file at a8846ef, and compare the two.
const BASELINE_SHA256 = 'da14f4213f4ae361d16bdfedc473efeda008e2123228cef3f288f4f07b3061b9'
const canonical = (ids) => JSON.stringify(Object.keys(ids).sort().map((k) => [k, ids[k]]))
const sha256 = (text) => require('crypto').createHash('sha256').update(text).digest('hex')

describe('Home Assistant discovery names (#1842)', () => {
  it('keeps unique_id, object_id, entity_id and topics of every entity', () => {
    expect(sha256(canonical(identity(load())))).toBe(BASELINE_SHA256)
  })

  it('has no entity name that repeats the name of its device', () => {
    const repeated = Object.entries(load())
      .map(([key, bot]) => [key, bot.input.params.payload])
      .filter(([, p]) => p.device && p.name === p.device.name)
      .map(([key]) => key)
    expect(repeated).toEqual([])
  })

  it('has no English or raw device name', () => {
    const names = new Set(Object.values(load()).map((bot) => bot.input.params.payload.device.name))
    const latin = [...names].filter((n) => /[A-Za-z_]/.test(n))
    expect(latin).toEqual([])
  })

  it('tells the door, the lock and the window of a room apart', () => {
    const shown = Object.values(load()).map((bot) => bot.input.params.payload)
      .filter((p) => p.device && p.device.name === 'Баня 1')
      .map((p) => p.name)
    expect(shown.sort()).toEqual(['Врата', 'Ключ', 'Прозорец', 'Таван'])
  })

  it('has no two entities with the same device and the same name', () => {
    const seen = {}
    for (const [key, bot] of Object.entries(load())) {
      const p = bot.input.params.payload
      if (!p.device) continue
      const id = `${p.device.identifiers}|${p.name}`
      expect(seen[id] === undefined ? null : [id, seen[id], key]).toBeNull()
      seen[id] = key
    }
  })
})

describe('automation switches', () => {
  it('each one has a bot in config.js, so its retained status exists', () => {
    // index.js publishes a retained status for every bot at start. A switch
    // without a bot has no state and Home Assistant shows "unknown".
    // The boiler bot runs in its own service, with its own config file.
    const configBots = {
      ...require(path.join(configDir, 'config.js')).bots,
      ...require(path.join(configDir, 'boiler-controller-config.js')).bots,
    }
    const switches = Object.entries(load())
      .map(([, bot]) => bot.input.params.payload)
      .filter((p) => /^homy\/automation\/.+\/control$/.test(p.command_topic || ''))
      .map((p) => p.command_topic.split('/')[2])

    expect(switches.length).toBeGreaterThan(0)
    expect(switches.filter((botName) => !configBots[botName])).toEqual([])
  })

  it('the pergola schedule stays off until the new valve is installed', () => {
    const configBots = require(path.join(configDir, 'config.js')).bots
    expect(configBots.irrigationGrassPergolaSchedule).toMatchObject({ type: 'irrigation', enabled: false })
  })
})

