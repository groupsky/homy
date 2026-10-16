const { afterEach, beforeEach, describe, expect, jest, test } = require('@jest/globals')
const path = require('path')

/**
 * Checks the bath1 light with the bots as they are deployed: the lock and the
 * debounced door contact from config/automations/features.js feed
 * lightBath1Controller from config/automations/config.js through a fake broker.
 *
 * The door contact is debounced for 2 s (#1742), so a person who unlocks, opens
 * the door and presses the wall switch can press it before the "door opened"
 * event arrives. The light must still end off (#1792).
 */

const configDir = path.resolve(__dirname, '../../config/automations')
const READING = '/modbus/dry-switches/mbsl32di1/reading'
// bath1DoorLock is bit 5, set when locked; bath1DoorOpen is bit 6, set when closed
const LOCKED = 1 << 5
const CLOSED = 1 << 6

const createBroker = (lightConfig) => {
  const subscribers = {}
  const broker = {
    lightOn: null,
    lightCommands: [],
    mqtt: {
      subscribe: (topic, callback) => {
        (subscribers[topic] = subscribers[topic] || []).push(callback)
      },
      publish: (topic, payload) => {
        if (topic === lightConfig.commandTopic) {
          broker.lightCommands.push(payload)
          // The light reports its new state a moment later
          setTimeout(() => {
            broker.lightOn = payload.state
            broker.deliver(lightConfig.statusTopic, { state: payload.state })
          }, 30)
        }
        broker.deliver(topic, payload)
      },
    },
    deliver: (topic, payload) => (subscribers[topic] || []).forEach((callback) => callback(payload)),
  }
  return broker
}

describe('bath1 light with the debounced door contact', () => {
  let broker
  let controller

  const reading = (inputs) => broker.deliver(READING, { inputs })
  const press = () => {
    broker.deliver(controller.toggle.statusTopic, { state: true })
    jest.advanceTimersByTime(200)
    broker.deliver(controller.toggle.statusTopic, { state: false })
  }

  beforeEach(() => {
    jest.useFakeTimers()
    // features.js prints its config, and the controller logs every step
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const features = require(path.join(configDir, 'features.js')).bots
    const { bots } = require(path.join(configDir, 'config.js'))
    controller = bots.lightBath1Controller
    broker = createBroker(controller.light)

    for (const name of ['bath1DoorLockState', 'bath1DoorOpenState']) {
      require(`./bots/${features[name].type}`)(name, features[name]).start({ mqtt: broker.mqtt })
    }
    require(`./bots/${controller.type}`)('lightBath1Controller', controller).start({ mqtt: broker.mqtt })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('leaving: unlock, open the door, press the wall switch 1.4 s later; the light ends off', () => {
    reading(LOCKED | CLOSED)
    jest.advanceTimersByTime(60000)
    expect(broker.lightOn).toBe(true)

    reading(CLOSED) // unlocked, door still closed
    jest.advanceTimersByTime(700)
    reading(0) // door opened; its event reaches the controller 2 s later
    jest.advanceTimersByTime(1400)
    const commandsBefore = broker.lightCommands.length
    press()

    jest.advanceTimersByTime(10000)
    expect(broker.lightOn).toBe(false)
    expect(broker.lightCommands.slice(commandsBefore)).toEqual([{ state: false, r: 'tgl-lon' }])
  })

  test('entering: the door opens while unlocked and the light is off; the light turns on', () => {
    reading(CLOSED)
    jest.advanceTimersByTime(3 * 60000) // the closed timeout turns the light off
    expect(broker.lightOn).toBe(false)

    reading(0)
    jest.advanceTimersByTime(2100)
    expect(broker.lightOn).toBe(true)
  })

  test('the wall switch wins only for a short time: a door-open 10 s after the press turns the light on', () => {
    reading(CLOSED) // the first door state turns the light on
    jest.advanceTimersByTime(1000)
    press()
    jest.advanceTimersByTime(10000)
    expect(broker.lightOn).toBe(false)

    reading(0)
    jest.advanceTimersByTime(2100)
    expect(broker.lightOn).toBe(true)
  })
})
