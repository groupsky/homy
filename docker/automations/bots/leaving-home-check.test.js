const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals')
const createBot = require('./leaving-home-check')

const HOUR = 60 * 60 * 1000

// Made-up places near 0° N 0° E. 0.001° of latitude is about 111 m.
const HOME = { lat: 0, lon: 0, radius_m: 100 }
const INSIDE = { lat: 0.0005, lon: 0 } // about 55 m
const MARGIN = { lat: 0.002, lon: 0 } // about 222 m: out of the radius, not past the margin
const OUTSIDE = { lat: 0.004, lon: 0 } // about 444 m

// Europe/Sofia is UTC+2 in November 2026
const MONDAY_7AM = Date.parse('2026-11-16T05:00:00Z')
const MONDAY_NOON = Date.parse('2026-11-16T10:00:00Z')
const SATURDAY_7AM = Date.parse('2026-11-21T05:00:00Z')

const CONFIG = {
  lights: ['kitchen_light', 'hall_light'],
  contacts: ['front_door_open', 'kitchen_window_open'],
  meters: [
    { name: 'oven', topic: '/modbus/secondary/oven/reading', minW: 1 },
    { name: 'stove', topic: '/modbus/secondary/stove/reading', minW: 10 }
  ],
  labels: { kitchen_light: 'кухня', oven: 'фурна', stove: 'котлон' }
}

const light = (name) => `homy/features/light/${name}/status`
const contact = (name) => `homy/features/open/${name}/status`

const startBot = ({ config = {}, cache, enabled = true, now = MONDAY_7AM } = {}) => {
  jest.setSystemTime(now)
  const subscriptions = new Map()
  const httpPost = jest.fn().mockResolvedValue({ ok: true })
  const mqtt = { subscribe: (topic, callback) => { subscriptions.set(topic, callback) }, publish: jest.fn() }
  const bot = createBot('leavingHomeCheck', { ...CONFIG, ...config, httpPost })
  const persistedCache = cache ?? structuredClone(bot.persistedCache.default)
  bot.start({ mqtt, persistedCache, isEnabled: () => enabled })
  const deliver = (topic, payload) => subscriptions.get(topic)?.(payload)
  const api = {
    persistedCache,
    deliver,
    fix: (place, extra = {}) => deliver('ioniq/parsed/gps', { provider: 'gps', acc_m: 10, ...place, ...extra }),
    // Everything off and closed, fresh
    allOff: () => {
      for (const name of CONFIG.lights) deliver(light(name), { state: false, _tz: Date.now() })
      for (const name of CONFIG.contacts) deliver(contact(name), { state: false, _tz: Date.now() })
      for (const meter of CONFIG.meters) deliver(meter.topic, { p: 0, _tz: Date.now() })
    },
    leave: () => { api.fix(INSIDE); api.fix(OUTSIDE) },
    messages: () => httpPost.mock.calls.map(([, body]) => body.message)
  }
  deliver('homy/ioniq/home', HOME)
  return api
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('leave detection', () => {
  test('inside, then past the margin: one message', () => {
    const bot = startBot()
    bot.allOff()
    bot.deliver(light('kitchen_light'), { state: true })
    bot.fix(INSIDE)
    expect(bot.persistedCache.place).toBe('home')
    bot.fix(MARGIN)
    expect(bot.messages()).toHaveLength(0)
    bot.fix(OUTSIDE)
    expect(bot.messages()).toEqual(['🚗 Колата тръгна. Вкъщи: светло: кухня.'])
  })

  test('one check per departure; back inside re-arms it', () => {
    const bot = startBot()
    bot.allOff()
    bot.deliver(light('kitchen_light'), { state: true })
    bot.leave()
    bot.fix(OUTSIDE)
    bot.fix(MARGIN)
    bot.fix(OUTSIDE)
    expect(bot.messages()).toHaveLength(1)
    bot.leave()
    expect(bot.messages()).toHaveLength(2)
  })

  test('the state survives a restart', () => {
    const first = startBot()
    first.fix(INSIDE)
    const bot = startBot({ cache: first.persistedCache })
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.fix(OUTSIDE)
    expect(bot.messages()).toHaveLength(1)
  })

  test('a far fix with no known state is not a departure', () => {
    const bot = startBot()
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.fix(OUTSIDE)
    expect(bot.persistedCache.place).toBe('away')
    expect(bot.messages()).toHaveLength(0)
  })

  test.each([
    ['network provider', { provider: 'network' }],
    ['poor accuracy', { acc_m: 80 }],
    ['a repeat of an old fix', { age_ms: 5000 }],
    ['no position', { lat: null }]
  ])('a bad fix is ignored: %s', (_, extra) => {
    const bot = startBot()
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.fix(INSIDE)
    bot.fix(OUTSIDE, extra)
    expect(bot.persistedCache.place).toBe('home')
    expect(bot.messages()).toHaveLength(0)
  })

  test('without a home place it does nothing', () => {
    jest.setSystemTime(MONDAY_7AM)
    const httpPost = jest.fn()
    const subscriptions = new Map()
    const bot = createBot('leavingHomeCheck', { ...CONFIG, httpPost })
    const persistedCache = { place: 'home' }
    bot.start({ mqtt: { subscribe: (t, cb) => subscriptions.set(t, cb) }, persistedCache })
    subscriptions.get('ioniq/parsed/gps')({ provider: 'gps', acc_m: 10, ...OUTSIDE })
    subscriptions.get('ioniq/parsed/gps')({ provider: 'gps', acc_m: 10, ...OUTSIDE })
    expect(persistedCache.place).toBe('home')
    expect(httpPost).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledTimes(1)
  })
})

describe('the check', () => {
  test('each kind of item, on and off', () => {
    const bot = startBot()
    bot.allOff()
    bot.deliver(light('kitchen_light'), { state: true })
    bot.deliver(contact('kitchen_window_open'), { state: true })
    bot.deliver('/modbus/secondary/oven/reading', { p: 2 })
    bot.deliver('/modbus/secondary/stove/reading', { p: 5 }) // under 10 W: off
    bot.leave()
    expect(bot.messages()).toEqual(['🚗 Колата тръгна. Вкъщи: светло: кухня; включено: фурна; отворено: kitchen_window_open.'])
  })

  test('the stove above 10 W', () => {
    const bot = startBot()
    bot.allOff()
    bot.deliver('/modbus/secondary/stove/reading', { p: 1500 })
    bot.leave()
    expect(bot.messages()).toEqual(['🚗 Колата тръгна. Вкъщи: включено: котлон.'])
  })

  test('nothing on or open: no message', () => {
    const bot = startBot()
    bot.allOff()
    bot.leave()
    expect(bot.messages()).toHaveLength(0)
  })

  test('values older than 24 h and missing values are listed as unknown', () => {
    const bot = startBot()
    bot.allOff()
    bot.deliver(contact('front_door_open'), { state: true })
    bot.deliver(light('hall_light'), { state: true, _tz: MONDAY_7AM - 25 * HOUR })
    bot.deliver(light('kitchen_light'), { state: false, _tz: MONDAY_7AM - 23 * HOUR })
    bot.deliver('/modbus/secondary/oven/reading', { p: 'bad' }) // kept: the fresh 0 W value
    bot.leave()
    expect(bot.messages()).toEqual(['🚗 Колата тръгна. Вкъщи: отворено: front_door_open; неизвестно: hall_light.'])
  })

  test('only unknown values: no message', () => {
    const bot = startBot()
    bot.leave()
    expect(bot.messages()).toHaveLength(0)
  })

  test('the ignore list', () => {
    const bot = startBot({ config: { ignore: ['hall_light'] } })
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.leave()
    expect(bot.messages()).toHaveLength(0)
  })

  test('the switch off: no message', () => {
    const bot = startBot({ enabled: false })
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.leave()
    expect(bot.messages()).toHaveLength(0)
  })
})

describe('workday mornings only', () => {
  test.each([
    ['a Saturday morning', SATURDAY_7AM],
    ['a workday at noon', MONDAY_NOON],
    ['a workday at 04:59', Date.parse('2026-11-16T02:59:00Z')]
  ])('%s: nothing is sent, the state still changes', (_, now) => {
    const bot = startBot({ now })
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.leave()
    expect(bot.persistedCache.place).toBe('away')
    expect(bot.messages()).toHaveLength(0)
  })

  test('the window comes from the config', () => {
    const bot = startBot({ now: MONDAY_NOON, config: { windowStart: '11:30', windowEnd: '12:30' } })
    bot.allOff()
    bot.deliver(light('hall_light'), { state: true })
    bot.leave()
    expect(bot.messages()).toHaveLength(1)
  })
})
