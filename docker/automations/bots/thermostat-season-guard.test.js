const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')
const createBot = require('./thermostat-season-guard')
const { parseSkip } = createBot

const MIN = 60 * 1000
const HOUR = 60 * MIN

const A = '/modbus/monitoring/thermostat-a'
const B = '/modbus/monitoring/thermostat-b'
const OUTDOOR = 'homy/weather/current'

// The same limits as the committed config, with made-up rooms
const CONFIG = {
  thermostatTopics: [A, B],
  outdoorTopic: OUTDOOR,
  valveOpenMaxMs: 3 * HOUR,
  valveOpenMonths: [10, 11, 12, 1, 2, 3, 4],
  minCoolingTargetTemp: 15,
  coldNightC: 8,
  nightStartHour: 22,
  nightEndHour: 7,
  minNightSamples: 12,
  outdoorMaxAgeMs: HOUR,
  outdoorHoldMs: 12 * HOUR,
  readingGapMs: 15 * MIN,
  timeZone: 'Europe/Sofia'
}

// Local time in Europe/Sofia is UTC+3 in October and July 2026
const OCT = Date.parse('2026-10-12T09:00:00Z') // 12:00 local
const JUL = Date.parse('2026-07-15T09:00:00Z')

const startBot = ({ cache, config = {} } = {}) => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  const subscriptions = new Map()
  const httpPost = jest.fn().mockResolvedValue({ ok: true })
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: jest.fn()
  }
  const bot = createBot('thermostatSeasonGuard', { ...CONFIG, ...config, httpPost })
  const persistedCache = cache ?? structuredClone(bot.persistedCache.default)
  bot.start({ mqtt, persistedCache })
  const deliver = (topic, payload) => subscriptions.get(topic)(payload)
  return {
    persistedCache,
    mqtt,
    httpPost,
    reading: (topic, at, values = {}) => deliver(`${topic}/reading`, {
      mode: 'cooling', targetTemp: 24, currentTemp: 23, valveStatus: 'off', _tz: at, ...values
    }),
    outdoor: (temperature, time, arrived = time) => deliver(OUTDOOR, { temperature, time: new Date(time).toISOString(), _tz: arrived }),
    messages: () => httpPost.mock.calls.map(([, body]) => body.message)
  }
}

// Feeds readings every 5 min from `from` to `to`
const feed = (bot, topic, from, to, values) => {
  for (let t = from; t <= to; t += 5 * MIN) bot.reading(topic, t, values)
}

// Outdoor values every 15 min over the night 2026-10-11 22:00 to 2026-10-12 06:45 local
const NIGHT_START = Date.parse('2026-10-11T19:00:00Z')
const coldNight = (bot, low) => {
  for (let i = 0; i < 36; i++) {
    const t = NIGHT_START + i * 15 * MIN
    bot.outdoor(i === 10 ? low : low + 3, t)
  }
}

afterEach(() => jest.restoreAllMocks())

describe('valveOpenLong', () => {
  test('valve open for more than 3 h in October: one message', () => {
    const bot = startBot()
    feed(bot, A, OCT, OCT + 4 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(1)
    expect(bot.messages()[0]).toContain('thermostat-a')
    expect(bot.messages()[0]).toContain('valveOpenLong')
    expect(bot.messages()[0]).toContain('Nothing was changed')
  })

  test('valve open for 4 h in July: no message', () => {
    const bot = startBot()
    feed(bot, A, JUL, JUL + 4 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('valve open for 2.5 h: no message', () => {
    const bot = startBot()
    feed(bot, A, OCT, OCT + 2.5 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('a gap of more than 15 min restarts the count', () => {
    const bot = startBot()
    feed(bot, A, OCT, OCT + 2 * HOUR, { valveStatus: 'on' })
    feed(bot, A, OCT + 2 * HOUR + 20 * MIN, OCT + 4 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('a reading with the valve closed restarts the count', () => {
    const bot = startBot()
    feed(bot, A, OCT, OCT + 2 * HOUR, { valveStatus: 'on' })
    bot.reading(A, OCT + 2 * HOUR + 5 * MIN, { valveStatus: 'off' })
    feed(bot, A, OCT + 2 * HOUR + 10 * MIN, OCT + 4 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('valve open in heating mode: no message', () => {
    const bot = startBot()
    feed(bot, A, OCT, OCT + 4 * HOUR, { valveStatus: 'on', mode: 'heating' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('the count survives a restart', () => {
    const first = startBot()
    feed(first, A, OCT, OCT + 2 * HOUR, { valveStatus: 'on' })
    const second = startBot({ cache: first.persistedCache })
    feed(second, A, OCT + 2 * HOUR + 5 * MIN, OCT + 4 * HOUR, { valveStatus: 'on' })
    expect(second.messages()).toHaveLength(1)
  })

  test('rooms are counted apart', () => {
    const bot = startBot()
    feed(bot, A, OCT, OCT + 2 * HOUR, { valveStatus: 'on' })
    feed(bot, B, OCT, OCT + 4 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(1)
    expect(bot.messages()[0]).toContain('thermostat-b')
  })
})

describe('lowCoolingTargetTemp', () => {
  test('set point 10.5 in cooling mode: message with the set point', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 10.5 })
    expect(bot.messages()).toHaveLength(1)
    expect(bot.messages()[0]).toContain('10.5')
    expect(bot.messages()[0]).toContain('lowCoolingTargetTemp')
  })

  test('set point 10.5 in heating mode: no message', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 10.5, mode: 'heating' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('also in July', () => {
    const bot = startBot()
    bot.reading(A, JUL, { targetTemp: 10.5 })
    expect(bot.messages()).toHaveLength(1)
  })

  test('set point 15 is fine', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 15 })
    expect(bot.messages()).toHaveLength(0)
  })

  test('a reading without mode or set point is ignored', () => {
    const bot = startBot()
    bot.reading(A, OCT, { mode: undefined })
    bot.reading(A, OCT, { targetTemp: undefined })
    expect(bot.messages()).toHaveLength(0)
  })
})

describe('one message per problem, room and day', () => {
  test('same problem again on the same day: no second message; next day: one more', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 10.5 })
    bot.reading(A, OCT + 5 * MIN, { targetTemp: 10.5 })
    bot.reading(A, OCT + 6 * HOUR, { targetTemp: 10.5 })
    expect(bot.messages()).toHaveLength(1)
    bot.reading(A, OCT + 24 * HOUR, { targetTemp: 10.5 })
    expect(bot.messages()).toHaveLength(2)
  })

  test('another room has its own message', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 10.5 })
    bot.reading(B, OCT, { targetTemp: 10.5 })
    expect(bot.messages()).toHaveLength(2)
  })

  test('the day is the local day: 21:30 UTC and 22:30 UTC are different days', () => {
    const bot = startBot()
    bot.reading(A, Date.parse('2026-10-12T20:30:00Z'), { targetTemp: 10.5 }) // 23:30 local
    bot.reading(A, Date.parse('2026-10-12T21:30:00Z'), { targetTemp: 10.5 }) // 00:30 local, next day
    expect(bot.messages()).toHaveLength(2)
  })

  test('a restart does not send again the same day', () => {
    const first = startBot()
    first.reading(A, OCT, { targetTemp: 10.5 })
    const second = startBot({ cache: first.persistedCache })
    second.reading(A, OCT + HOUR, { targetTemp: 10.5 })
    expect(second.messages()).toHaveLength(0)
  })

  test('old days are removed from the sent list', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 10.5 })
    bot.reading(B, OCT + 24 * HOUR, { targetTemp: 10.5 })
    expect(Object.keys(bot.persistedCache.sent)).toEqual(['thermostat-b:lowCoolingTargetTemp'])
  })

  test('the bot never publishes', () => {
    const bot = startBot()
    bot.reading(A, OCT, { targetTemp: 10.5 })
    expect(bot.mqtt.publish).not.toHaveBeenCalled()
  })
})

describe('coolingInColdNights', () => {
  const NOW = Date.parse('2026-10-12T05:00:00Z') // 08:00 local, after the night

  test('cold last night: message', () => {
    const bot = startBot()
    coldNight(bot, 4)
    bot.reading(A, NOW)
    expect(bot.messages()).toHaveLength(1)
    expect(bot.messages()[0]).toContain('coolingInColdNights')
    expect(bot.messages()[0]).toContain('4')
  })

  test('warm last night: no message', () => {
    const bot = startBot()
    coldNight(bot, 12)
    bot.reading(A, NOW)
    expect(bot.messages()).toHaveLength(0)
  })

  test('heating mode: no message', () => {
    const bot = startBot()
    coldNight(bot, 4)
    bot.reading(A, NOW, { mode: 'heating' })
    expect(bot.messages()).toHaveLength(0)
  })

  test('a listed room gets no cold night message but still gets valveOpenLong', () => {
    const bot = startBot({ config: { skip: 'thermostat-a:coolingInColdNights' } })
    coldNight(bot, 4)
    bot.reading(A, NOW)
    expect(bot.messages()).toHaveLength(0)
    feed(bot, A, NOW + 5 * MIN, NOW + 4 * HOUR, { valveStatus: 'on' })
    expect(bot.messages()).toHaveLength(1)
    expect(bot.messages()[0]).toContain('valveOpenLong')
    bot.reading(B, NOW)
    expect(bot.messages()).toHaveLength(2)
  })

  test('no outdoor data: no check and no crash', () => {
    const bot = startBot()
    expect(() => bot.reading(A, NOW)).not.toThrow()
    expect(bot.messages()).toHaveLength(0)
  })

  test('a value that is old on arrival is dropped', () => {
    const bot = startBot()
    for (let i = 0; i < 36; i++) {
      const t = NIGHT_START + i * 15 * MIN
      bot.outdoor(2, t, t + 2 * HOUR)
    }
    expect(bot.persistedCache.outdoorSamples).toHaveLength(0)
    bot.reading(A, NOW)
    expect(bot.messages()).toHaveLength(0)
  })

  test('the same time is kept once', () => {
    const bot = startBot()
    bot.outdoor(3, NIGHT_START)
    bot.outdoor(3, NIGHT_START)
    expect(bot.persistedCache.outdoorSamples).toHaveLength(1)
  })

  test('newest value older than 12 h: check is skipped', () => {
    const bot = startBot()
    coldNight(bot, 4)
    bot.reading(A, NOW + 14 * HOUR)
    expect(bot.messages()).toHaveLength(0)
  })

  test('a night with fewer than 12 values does not count', () => {
    const bot = startBot()
    for (let i = 0; i < 8; i++) bot.outdoor(2, NIGHT_START + i * 15 * MIN)
    bot.reading(A, NOW)
    expect(bot.messages()).toHaveLength(0)
  })

  test('the night in progress counts when it has enough values', () => {
    const bot = startBot()
    for (let i = 0; i < 14; i++) bot.outdoor(2, NIGHT_START + i * 15 * MIN)
    bot.reading(A, NIGHT_START + 14 * 15 * MIN)
    expect(bot.messages()).toHaveLength(1)
  })

  test('the newest complete night is used, not an older cold one', () => {
    const bot = startBot()
    for (let i = 0; i < 20; i++) bot.outdoor(2, NIGHT_START - 24 * HOUR + i * 15 * MIN)
    for (let i = 0; i < 20; i++) bot.outdoor(12, NIGHT_START + i * 15 * MIN)
    bot.reading(A, NOW)
    expect(bot.messages()).toHaveLength(0)
  })

  test('values older than 36 h are dropped', () => {
    const bot = startBot()
    bot.outdoor(3, NIGHT_START)
    bot.outdoor(3, NIGHT_START + 40 * HOUR)
    expect(bot.persistedCache.outdoorSamples).toHaveLength(1)
  })

  test('the data switch is logged once, not on every reading', () => {
    const bot = startBot()
    bot.reading(A, NOW)
    bot.reading(A, NOW + 5 * MIN)
    bot.reading(B, NOW + 10 * MIN)
    const offLogs = console.log.mock.calls.filter(([line]) => /no outdoor data/.test(line))
    expect(offLogs).toHaveLength(1)
  })
})

describe('parseSkip', () => {
  test('empty or missing: no exceptions', () => {
    expect(parseSkip('')).toEqual({ skip: {}, unknown: [] })
    expect(parseSkip(undefined)).toEqual({ skip: {}, unknown: [] })
    expect(parseSkip(' , ')).toEqual({ skip: {}, unknown: [] })
  })

  test('pairs, with several checks for one room', () => {
    expect(parseSkip('thermostat-x:coolingInColdNights, thermostat-x:valveOpenLong,thermostat-y:lowCoolingTargetTemp')).toEqual({
      skip: {
        'thermostat-x': ['coolingInColdNights', 'valveOpenLong'],
        'thermostat-y': ['lowCoolingTargetTemp']
      },
      unknown: []
    })
  })

  test('an unknown check or a bad pair is left out and reported', () => {
    expect(parseSkip('thermostat-x:nope,thermostat-y,thermostat-z:valveOpenLong')).toEqual({
      skip: { 'thermostat-z': ['valveOpenLong'] },
      unknown: ['thermostat-x:nope', 'thermostat-y']
    })
  })

  test('the bot logs an error at start for an unknown check and ignores it', () => {
    const bot = startBot({ config: { skip: 'thermostat-a:nope' } })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('thermostat-a:nope'))
    bot.reading(A, OCT, { targetTemp: 10.5 })
    expect(bot.messages()).toHaveLength(1)
  })
})

describe('committed config', () => {
  const config = require(path.resolve(__dirname, '../../../config/automations/config.js')).bots.thermostatSeasonGuard

  test('takes the room list from the clock sync bots, with distinct room keys', () => {
    const rooms = config.thermostatTopics.map((topic) => topic.split('/').filter(Boolean).pop())
    expect(rooms.length).toBeGreaterThan(0)
    expect(new Set(rooms).size).toBe(rooms.length)
  })

  test('the type resolves to this bot', () => {
    expect(config.type).toBe('thermostat-season-guard')
    expect(config.outdoorTopic).toBe('homy/weather/current')
  })
})
