const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const safetySiren = require('./safety-siren')

const SIREN_STATE = 'z2m/house1/floor1-alarm'
const SIREN_SET = 'z2m/house1/floor1-alarm/set'
const TANK = 'homy/features/sensor/temperature_boiler_high/status'
const BUTTON_LEFT = 'homy/features/button/corridor1_kitchen_left/status'
const BUTTON_RIGHT = 'homy/features/button/corridor1_kitchen_right/status'
const HA_STOP = 'homy/features/button/safety_siren_stop/trigger'
const HA_TEST = 'homy/features/button/safety_siren_test/trigger'
const MUTE_SET = 'homy/features/switch/safety_siren_mute/set'
const MUTE_STATUS = 'homy/features/switch/safety_siren_mute/status'

// 2026-10-21 is in summer time, so local (Europe/Sofia) = UTC + 3.
const LOCAL_NOON = Date.parse('2026-10-21T09:00:00Z')
const LOCAL_0300 = Date.parse('2026-10-21T00:00:00Z')

const TANK_SOUND = { alarm: true, melody: 6, volume: 'high', duration: 60 }

describe('safety-siren bot', () => {
  let mqtt
  let persistedCache
  let httpPost

  const config = (overrides = {}) => ({
    siren: { stateTopic: SIREN_STATE, commandTopic: SIREN_SET },
    alerts: [{
      name: 'tank_overheat',
      label: 'Tank over 85 °C',
      topic: TANK,
      above: 85,
      confirmMs: 2 * 60 * 1000,
      maxAgeMs: 60 * 1000,
      dayOnly: true,
      melody: 6,
      volume: 'high',
      durationSec: 60,
      times: 3,
      pauseSec: 60
    }],
    stopButtonTopics: [BUTTON_LEFT, BUTTON_RIGHT],
    stopTopic: HA_STOP,
    test: { topic: HA_TEST, melody: 6, volume: 'high', durationSec: 30 },
    mute: { commandTopic: MUTE_SET, statusTopic: MUTE_STATUS, maxMs: 2 * 60 * 60 * 1000 },
    day: { fromHour: 7, toHour: 23, timeZone: 'Europe/Sofia' },
    aliveMaxAgeMs: 3 * 60 * 60 * 1000,
    httpPost,
    ...overrides
  })

  const send = (topic, payload) => mqtt._callbacks[topic](payload)
  const sirenCalls = () => mqtt.publish.mock.calls.filter(([topic]) => topic === SIREN_SET).map(([, payload]) => payload)
  const telegrams = () => httpPost.mock.calls.map(([, body]) => body.message)

  // One tank reading every 10 s for `ms`, like the real sensor (which sends
  // about one a second).
  const tankFor = async (value, ms) => {
    for (let t = 0; t < ms; t += 10000) {
      await send(TANK, { state: value })
      await jest.advanceTimersByTimeAsync(10000)
    }
  }

  const start = async (cfg = config()) => {
    const bot = safetySiren('safetySiren', cfg)
    persistedCache = persistedCache || JSON.parse(JSON.stringify(bot.persistedCache.default))
    await bot.start({ mqtt, persistedCache })
    return bot
  }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(LOCAL_NOON)
    persistedCache = undefined
    httpPost = jest.fn().mockResolvedValue({ ok: true })
    mqtt = {
      _callbacks: {},
      subscribe: jest.fn((topic, cb) => { mqtt._callbacks[topic] = cb; return Promise.resolve() }),
      publish: jest.fn().mockResolvedValue()
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  describe('configuration', () => {
    it('needs the siren command topic', () => {
      expect(() => safetySiren('s', config({ siren: { stateTopic: SIREN_STATE } }))).toThrow(/siren.commandTopic/)
    })

    it('needs a valid volume and melody for each alert', () => {
      const bad = config()
      bad.alerts[0].volume = 'loud'
      expect(() => safetySiren('s', bad)).toThrow(/volume/)
      const noMelody = config()
      delete noMelody.alerts[0].melody
      expect(() => safetySiren('s', noMelody)).toThrow(/melody/)
    })

    it('needs a numeric threshold for each alert', () => {
      const bad = config()
      delete bad.alerts[0].above
      expect(() => safetySiren('s', bad)).toThrow(/above/)
    })
  })

  describe('confirm first', () => {
    it('sounds once the value stayed above the limit for the confirm time', async () => {
      await start()
      await tankFor(86, 110 * 1000)
      expect(sirenCalls()).toEqual([])

      await tankFor(86, 20 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('starts the confirm time again after one reading at or below the limit', async () => {
      await start()
      await tankFor(86, 100 * 1000)
      await send(TANK, { state: 85 })
      await tankFor(86, 100 * 1000)
      expect(sirenCalls()).toEqual([])
    })

    it('never sounds for a value at the limit', async () => {
      await start()
      await tankFor(85, 10 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
    })
  })

  describe('never sounds for no data or bad data', () => {
    it('never sounds when readings stop before the confirm time ends', async () => {
      await start()
      await tankFor(86, 60 * 1000)
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
    })

    it('never sounds for null, text or missing values', async () => {
      await start()
      for (let i = 0; i < 30; i++) {
        await send(TANK, { state: null })
        await send(TANK, { state: '90' })
        await send(TANK, {})
        await send(TANK, null)
        await jest.advanceTimersByTimeAsync(10000)
      }
      expect(sirenCalls()).toEqual([])
    })

    it('never sounds when no reading ever came', async () => {
      await start()
      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
    })

    it('never sounds for messages that are not one of its safety inputs', async () => {
      await start()
      // A non-safety alert, a door opening, a light button and HA stop/mute
      // messages: none of them is a safety input, so none sounds the siren.
      for (const topic of Object.keys(mqtt._callbacks).filter((t) => t !== TANK && t !== HA_TEST && t !== MUTE_SET)) {
        await send(topic, { state: true, _src: 'ha' })
        await send(topic, { state: 99 })
      }
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
      expect(mqtt.subscribe.mock.calls.map(([topic]) => topic)).not.toContain('homy/features/open/front_main_door_open/status')
    })
  })

  describe('day only', () => {
    it('does not sound at night', async () => {
      jest.setSystemTime(LOCAL_0300)
      await start()
      await tankFor(90, 10 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
    })

    it('sounds at 07:00 when the alert is still active from the night', async () => {
      jest.setSystemTime(Date.parse('2026-10-21T03:50:00Z')) // 06:50 local
      await start()
      await tankFor(90, 9 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
      await tankFor(90, 2 * 60 * 1000) // past 07:00 local
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('a row without dayOnly sounds at night too', async () => {
      jest.setSystemTime(LOCAL_0300)
      const cfg = config()
      cfg.alerts[0].dayOnly = false
      await start(cfg)
      await tankFor(90, 3 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })
  })

  describe('repeat', () => {
    it('sounds up to 3 times, with a pause between, while the alert holds', async () => {
      await start()
      await tankFor(90, 60 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND, TANK_SOUND, TANK_SOUND])
    })

    it('stops the sound and the repeats when the value stays under the limit for the confirm time', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND])
      await send(TANK, { state: 80 })
      await tankFor(80, 30 * 60 * 1000)
      // no repeat while the value is under the limit, and the sound ends by itself
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('stops a sound that still plays when the alert clears', async () => {
      const cfg = config()
      cfg.alerts[0].durationSec = 600
      await start(cfg)
      await tankFor(90, 130 * 1000)
      await tankFor(80, 130 * 1000)
      expect(sirenCalls()).toEqual([{ ...TANK_SOUND, duration: 600 }, { alarm: false }])
    })

    it('one reading at the limit does not end the alert: no new episode after a stop', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      await send(HA_STOP, { _src: 'ha' })
      await send(TANK, { state: 85 })
      await tankFor(90, 30 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND, { alarm: false }])
    })

    it('sounds no more repeats when the readings stop after the first sound', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('a new episode after the alert cleared sounds again', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      await tankFor(80, 130 * 1000)
      await tankFor(90, 130 * 1000)
      expect(sirenCalls().filter((p) => p.alarm)).toHaveLength(2)
    })
  })

  describe('stop', () => {
    const pressLeft = async () => {
      await send(BUTTON_LEFT, { state: true })
      await send(BUTTON_LEFT, { state: false })
    }

    it('a hall wall button stops the sound and the repeats', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false }) // the retained first message
      await tankFor(90, 130 * 1000)
      await pressLeft()
      expect(sirenCalls()).toEqual([TANK_SOUND, { alarm: false }])
      await tankFor(90, 30 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND, { alarm: false }])
    })

    it('a wall button does nothing while no siren alert is active', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false })
      await pressLeft()
      await pressLeft()
      expect(sirenCalls()).toEqual([])
    })

    it('a wall button does nothing while a confirmed alert waits quietly for the day', async () => {
      jest.setSystemTime(Date.parse('2026-10-20T23:00:00Z')) // 02:00 local
      await start()
      await send(BUTTON_LEFT, { state: false })
      await tankFor(90, 3 * 60 * 1000)
      await pressLeft() // someone turns on the hall light at night
      await tankFor(90, 5.2 * 60 * 60 * 1000) // until after 07:04 local
      expect(sirenCalls()).toEqual([TANK_SOUND, TANK_SOUND, TANK_SOUND])
    })

    it('a wall button does nothing while the mute holds the alert quiet', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false })
      await send(MUTE_SET, { state: true, _src: 'ha' })
      await tankFor(90, 3 * 60 * 1000)
      await pressLeft()
      await send(MUTE_SET, { state: false, _src: 'ha' })
      await tankFor(90, 20 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('a wall button in the pause between two sounds stops the repeats', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false })
      await tankFor(90, 130 * 1000)
      await tankFor(90, 70 * 1000) // the first sound has ended, the pause runs
      await pressLeft()
      await tankFor(90, 30 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('a wall button after all repeats are done does nothing', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false })
      await tankFor(90, 30 * 60 * 1000)
      await pressLeft()
      expect(sirenCalls()).toEqual([TANK_SOUND, TANK_SOUND, TANK_SOUND])
    })

    it('the first (retained) button message is not a press', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      await send(BUTTON_RIGHT, { state: true })
      expect(sirenCalls()).toEqual([TANK_SOUND])
    })

    it('the Home Assistant stop button also stops a quiet alert, without a command', async () => {
      jest.setSystemTime(Date.parse('2026-10-20T23:00:00Z')) // 02:00 local
      await start()
      await tankFor(90, 3 * 60 * 1000)
      await send(HA_STOP, { _src: 'ha' })
      await tankFor(90, 5 * 60 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
    })

    it('the Home Assistant stop button stops it', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      await send(HA_STOP, { _src: 'ha' })
      expect(sirenCalls()).toEqual([TANK_SOUND, { alarm: false }])
    })
  })

  describe('MQTT failures', () => {
    it('a failed publish is caught, and the next repeat still sounds', async () => {
      await start()
      mqtt.publish.mockRejectedValueOnce(new Error('broker down'))
      await tankFor(90, 30 * 60 * 1000)
      expect(sirenCalls()).toEqual([TANK_SOUND, TANK_SOUND, TANK_SOUND])
    })
  })

  describe('maintenance mute', () => {
    it('blocks the sound while on, says so in its status, and turns itself off', async () => {
      await start()
      expect(mqtt.publish).toHaveBeenCalledWith(MUTE_STATUS, { state: false }, { retain: true })
      await send(MUTE_SET, { state: true, _src: 'ha' })
      expect(mqtt.publish).toHaveBeenCalledWith(MUTE_STATUS, { state: true }, { retain: true })

      await tankFor(90, 30 * 60 * 1000)
      expect(sirenCalls()).toEqual([])

      await tankFor(90, 2 * 60 * 60 * 1000)
      expect(mqtt.publish).toHaveBeenLastCalledWith(SIREN_SET, TANK_SOUND)
      expect(mqtt.publish.mock.calls.filter(([t, p]) => t === MUTE_STATUS && p.state === false)).toHaveLength(2)
    })

    it('turning mute on stops a sound that is playing', async () => {
      await start()
      await tankFor(90, 130 * 1000)
      await send(MUTE_SET, { state: true, _src: 'ha' })
      expect(sirenCalls()).toEqual([TANK_SOUND, { alarm: false }])
    })

    it('keeps the mute over a restart until it ends', async () => {
      await start()
      await send(MUTE_SET, { state: true, _src: 'ha' })
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000)

      mqtt.publish.mockClear()
      await start()
      expect(mqtt.publish).toHaveBeenCalledWith(MUTE_STATUS, { state: true }, { retain: true })
      await tankFor(90, 10 * 60 * 1000)
      expect(sirenCalls()).toEqual([])
      await tankFor(90, 60 * 60 * 1000)
      expect(sirenCalls()).toContainEqual(TANK_SOUND)
    })
  })

  describe('test button', () => {
    it('sounds the test melody and volume, and a wall button stops it', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false })
      await send(HA_TEST, { _src: 'ha' })
      expect(sirenCalls()).toEqual([{ alarm: true, melody: 6, volume: 'high', duration: 30 }])
      await send(BUTTON_LEFT, { state: true })
      expect(sirenCalls()).toEqual([{ alarm: true, melody: 6, volume: 'high', duration: 30 }, { alarm: false }])
    })

    it('a wall button after the test sound ended does nothing', async () => {
      await start()
      await send(BUTTON_LEFT, { state: false })
      await send(HA_TEST, { _src: 'ha' })
      await jest.advanceTimersByTimeAsync(31 * 1000)
      await send(BUTTON_LEFT, { state: true })
      expect(sirenCalls()).toHaveLength(1)
    })
  })

  describe('siren alive check', () => {
    const seenAt = (ms) => send(SIREN_STATE, { alarm: false, last_seen: new Date(ms).toISOString() })

    it('sends one message when the siren is silent for 3 h, and one when it is back', async () => {
      await start()
      await seenAt(Date.now())
      await jest.advanceTimersByTimeAsync(2.9 * 60 * 60 * 1000)
      expect(telegrams()).toEqual([])
      await jest.advanceTimersByTimeAsync(0.2 * 60 * 60 * 1000)
      expect(telegrams()).toHaveLength(1)
      expect(telegrams()[0]).toMatch(/siren/i)
      await jest.advanceTimersByTimeAsync(5 * 60 * 60 * 1000)
      expect(telegrams()).toHaveLength(1)

      await seenAt(Date.now())
      expect(telegrams()).toHaveLength(2)
      expect(telegrams()[1]).toMatch(/back/i)
    })

    it('uses last_seen, not the time the message came: an old state sent again is not a sign of life', async () => {
      await start()
      await seenAt(Date.now())
      await jest.advanceTimersByTimeAsync(2.5 * 60 * 60 * 1000)
      // zigbee2mqtt restarts and sends the old state again, with the old last_seen
      await seenAt(Date.now() - 2.5 * 60 * 60 * 1000)
      await jest.advanceTimersByTimeAsync(0.6 * 60 * 60 * 1000)
      expect(telegrams()).toHaveLength(1)
    })

    it('reads a numeric last_seen too', async () => {
      await start()
      await send(SIREN_STATE, { last_seen: Date.now() })
      await jest.advanceTimersByTimeAsync(2.5 * 60 * 60 * 1000)
      await send(SIREN_STATE, { last_seen: Date.now() - 2.5 * 60 * 60 * 1000 })
      await jest.advanceTimersByTimeAsync(0.6 * 60 * 60 * 1000)
      expect(telegrams()).toHaveLength(1)
    })

    it('counts from the start when the siren never sent anything', async () => {
      await start()
      await jest.advanceTimersByTimeAsync(3.1 * 60 * 60 * 1000)
      expect(telegrams()).toHaveLength(1)
    })
  })
})
