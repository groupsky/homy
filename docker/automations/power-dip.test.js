const { afterEach, beforeEach, describe, expect, jest, test } = require('@jest/globals')
const path = require('path')

/**
 * Replays the mains dip of 2026-11-16 (#1956) through the bots as they are
 * deployed: the module and relay features from config/automations/features.js
 * and the wall-switch toggle bots from config/automations/config.js, joined by
 * a fake broker and two fake relay boards.
 *
 * In the dip both input modules read `inputs: 0` for 4.5 s while the relay
 * boards restarted, so the first relay writes timed out. Four lights switched
 * on by themselves.
 */

const configDir = path.resolve(__dirname, '../../config/automations')
const DI1 = '/modbus/dry-switches/mbsl32di1/reading'
const DI2 = '/modbus/dry-switches/mbsl32di2/reading'
// mbsl32di2 before the dip: the bedroom, boris and gergana latching switches closed
const DI2_BEFORE = 3157139
// mbsl32di1: bath1 door closed (bit 6) and unlocked, plus other closed contacts
const BATH1_DOOR_CLOSED = 1 << 6
const DI1_BEFORE = BATH1_DOOR_CLOSED | (1 << 26) | (1 << 27) | (1 << 28) | (1 << 29)
const RELAY_POLL_MS = 1000

const createHouse = () => {
  const subscribers = {}
  const boards = {
    'relays00-15': { outputs: 0, up: true },
    'relays16-31': { outputs: 0, up: true },
  }
  const published = []
  const deliver = (topic, payload) => (subscribers[topic] || []).slice().forEach((cb) => cb(payload))
  const pollBoard = (name) => {
    if (boards[name].up) deliver(`/modbus/dry-switches/${name}/reading`, { outputs: boards[name].outputs })
  }
  const mqtt = {
    subscribe: (topic, cb) => { (subscribers[topic] = subscribers[topic] || []).push(cb) },
    publish: (topic, payload) => {
      published.push({ topic, payload })
      const write = topic.match(/^\/modbus\/dry-switches\/(relays\d\d-\d\d)\/write$/)
      if (write) {
        const board = boards[write[1]]
        // a board that is restarting does not answer: the write times out
        if (!board.up) return
        for (const [key, on] of Object.entries(payload)) {
          const bit = 1 << Number(key.slice(3))
          board.outputs = on ? board.outputs | bit : board.outputs & ~bit
        }
        setTimeout(() => pollBoard(write[1]), 50)
        return
      }
      deliver(topic, payload)
    },
  }
  setInterval(() => Object.keys(boards).forEach(pollBoard), RELAY_POLL_MS)
  return { mqtt, boards, deliver, published }
}

const LIGHTS = {
  bedroom_ceiling_light: ['relays16-31', 8],
  gergana_ceiling_light: ['relays16-31', 10],
  boris_ceiling_light: ['relays16-31', 11],
  corridor2_both_ceiling_lights: ['relays00-15', 10],
}

describe('a power dip that resets the input modules and the relay boards (#1956)', () => {
  let house

  const isOn = (light) => {
    const [board, bit] = LIGHTS[light]
    return Boolean(house.boards[board].outputs & (1 << bit))
  }
  const lightsOn = () => Object.keys(LIGHTS).filter(isOn)
  const statuses = (topic) => house.published.filter((m) => m.topic === topic).map((m) => m.payload.state)

  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.isolateModules(() => {
      const features = require(path.join(configDir, 'features.js')).bots
      const { bots } = require(path.join(configDir, 'config.js'))
      house = createHouse()
      for (const [name, bot] of Object.entries(features)) {
        require(`./bots/${bot.type}`)(name, bot).start({ mqtt: house.mqtt })
      }
      for (const [name, bot] of Object.entries(bots)) {
        if (bot.type === 'feature-toggle-on-feature-change') {
          require(`./bots/${bot.type}`)(name, bot).start({ mqtt: house.mqtt })
        }
      }
    })
    house.deliver(DI1, { inputs: DI1_BEFORE })
    house.deliver(DI2, { inputs: DI2_BEFORE })
    jest.advanceTimersByTime(5000)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('replay of 2026-11-16: 4.5 s of all-zero readings while the relay boards restart leave the lights as they were', () => {
    expect(lightsOn()).toEqual([])

    // 11:13:46.5: the boards restart and both modules read all zeros
    house.boards['relays00-15'].up = false
    house.boards['relays16-31'].up = false
    for (let t = 0; t < 4500; t += 100) {
      house.deliver(DI1, { inputs: 0 })
      house.deliver(DI2, { inputs: 0 })
      jest.advanceTimersByTime(100)
    }
    // 11:13:51.0: the boards are back with all outputs off, the real readings return
    house.boards['relays00-15'] = { outputs: 0, up: true }
    house.boards['relays16-31'] = { outputs: 0, up: true }
    house.deliver(DI1, { inputs: DI1_BEFORE })
    house.deliver(DI2, { inputs: DI2_BEFORE })
    jest.advanceTimersByTime(10000)

    expect(lightsOn()).toEqual([])
  })

  test('one real switch flip on the same module toggles its light at once', () => {
    house.deliver(DI2, { inputs: DI2_BEFORE & ~(1 << 7) }) // bedroom switch flipped
    jest.advanceTimersByTime(60) // only the board's own write and status time
    expect(lightsOn()).toEqual(['bedroom_ceiling_light'])

    jest.advanceTimersByTime(2000)
    house.deliver(DI2, { inputs: DI2_BEFORE }) // flipped back
    jest.advanceTimersByTime(60)
    expect(lightsOn()).toEqual([])
  })

  test('an all-zero reading does not report the doors open; a real door opening still does', () => {
    const doorTopic = 'homy/features/open/bath1_door_open/status'
    const before = statuses(doorTopic)
    expect(before[before.length - 1]).toBe(false)

    house.deliver(DI1, { inputs: 0 })
    jest.advanceTimersByTime(5000)
    expect(statuses(doorTopic).slice(before.length)).not.toContain(true)

    house.deliver(DI1, { inputs: DI1_BEFORE & ~BATH1_DOOR_CLOSED }) // the door opens
    jest.advanceTimersByTime(2100) // the bath1 door contact is debounced for 2 s (#1742)
    expect(statuses(doorTopic).slice(before.length)).toContain(true)
  })
})
