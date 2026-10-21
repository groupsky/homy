const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live topics and limits.
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

const MIN = 60 * 1000

// Local wall-clock times with their offset: +02:00 is winter, +03:00 summer.
// Winter night zone starts at 22:00 (T), summer at 23:00. The test runner runs
// in UTC (jest.global-setup.js).
const WINTER_T = '2026-11-02T22:00:00+02:00'
// Well inside the night zone and outside the hold, so only the load gates act.
const AFTER_HOLD = '2026-11-03T01:00:00+02:00'

const startAt = (localIso, { config = CONFIG, controlMode = 'automatic' } = {}) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload) => { published.push({ topic, payload }) }
  }
  const httpPost = async () => ({ ok: true })
  require('./boiler-controller')('boiler', { ...config, httpPost }).start({
    mqtt,
    persistedCache: { controlMode, manualOverrideExpires: controlMode === 'automatic' ? null : Date.now() + 24 * 60 * MIN }
  })
  const deliver = (topic, payload) => {
    const callback = subscriptions.get(topic)
    if (typeof callback !== 'function') throw new Error(`no subscription for ${topic}`)
    callback(payload)
  }
  const stamp = () => new Date().toISOString()
  const boiler = {
    temperatures: ({ top, bottom = 35 }) => {
      deliver(config.temperatureBottomTopic, { state: bottom, _tz: Date.now() })
      deliver(config.temperatureTopTopic, { state: top, _tz: Date.now() })
    },
    mainPower: (total_p, _tz = Date.now()) => deliver(config.mainPowerTopic, { total_p, _tz }),
    dishwasher: (p, _tz = Date.now()) => deliver(config.dishwasherTopic, { p, _tz }),
    // Advances the clock in 1 s steps, sending the readings a meter would send
    // and a fresh temperature every 30 s (the sensors report regularly).
    run: (ms, { main, dish, top, bottom = 35 } = {}) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        jest.setSystemTime(Date.now() + 1000)
        if (main != null) boiler.mainPower(typeof main === 'function' ? main(elapsed) : main)
        if (dish != null) boiler.dishwasher(dish)
        if (top != null && elapsed % 30000 === 0) boiler.temperatures({ top, bottom })
      }
    },
    at: (localIso) => jest.setSystemTime(new Date(localIso)),
    relay: () => published.filter(m => m.topic === config.boilerRelayTopic).at(-1).payload,
    status: () => published.filter(m => m.topic === config.automationStatusTopic).at(-1).payload,
    relayCount: () => published.filter(m => m.topic === config.boilerRelayTopic).length,
    stamp
  }
  return boiler
}

// Top under comfortMin (47) and above the floor (40) and emergencyMin (30).
const COLD_ENOUGH_TO_HEAT = 45

describe('boiler-controller load stagger', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('the committed config sets both topics and the limits', () => {
    expect(CONFIG.dishwasherTopic).toBe('/modbus/secondary/dishwasher/reading')
    expect(CONFIG.mainPowerTopic).toBe('/modbus/main/main/reading')
    expect(CONFIG).toMatchObject({
      dishwasherOnW: 10,
      dishwasherHoldMs: 10 * MIN,
      mainPowerCapW: 6000,
      mainPowerMeanMs: 5 * MIN,
      maxLoadInputAgeMs: 10 * MIN
    })
  })

  describe('dishwasher gate', () => {
    test('the element does not start while the dishwasher shows load', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })

    test('a pause under 10 minutes still blocks; after 10 minutes idle the element starts', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      boiler.run(9 * MIN, { dish: 2, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
      boiler.run(1 * MIN + 2000, { dish: 2, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })

    test('a reading at exactly the on threshold is not load', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(10)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
    })

    test('an old dishwasher reading counts as not running', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200, Date.now() - 11 * MIN)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })

    test('a reading without a numeric power is ignored', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(undefined)
      boiler.dishwasher('1200')
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
    })
  })

  describe('main power cap', () => {
    test('no start while the 5-minute mean is at or above 6 kW; start when it drops under', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.run(5 * MIN, { main: 6000, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_main_power' })
      // The mean falls under 6 kW once enough of the window holds lower readings.
      boiler.run(2.6 * MIN, { main: 3000, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })

    test('a short spike does not block while the mean stays under the cap', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.run(4 * MIN, { main: 2000, top: COLD_ENOUGH_TO_HEAT })
      boiler.run(30 * 1000, { main: 9000, top: COLD_ENOUGH_TO_HEAT })
      boiler.run(10 * 1000, { main: 2000, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })

    test('the mean uses only the last 5 minutes', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.run(2 * MIN, { main: 9000 })
      boiler.run(5 * MIN, { main: 1000, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
    })

    test('a short silence keeps the cap; a long silence ignores it', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.run(5 * MIN, { main: 6500 })
      boiler.run(6 * MIN, {})
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_main_power' })
      boiler.run(4 * MIN + 2000, {})
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })

    test('a _tz in the future counts as now, so the reading still ages out', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.mainPower(9000, Date.now() + 60 * MIN)
      boiler.dishwasher(1200, Date.now() + 60 * MIN)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay().reason).toBe('load_wait_dishwasher')
      boiler.run(10 * MIN + 2000, { top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
    })

    test('an old main reading (over 10 minutes) ignores the cap', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.mainPower(9000, Date.now() - 11 * MIN)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
      expect(boiler.status().load).toMatchObject({ capIgnored: true })
    })

    test('no main reading at all ignores the cap', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
    })

    test('a reading without a numeric total_p is ignored', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.mainPower(undefined)
      boiler.mainPower('9000')
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
    })

    test('the dishwasher reason comes first when both apply', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.mainPower(9000)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })
  })

  describe('a running element', () => {
    test('is not stopped when the cap is exceeded or the dishwasher starts', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true })
      boiler.run(6 * MIN, { main: 9000, dish: 1200, top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })
  })

  describe('which rules are gated', () => {
    test('the bottom-cold start waits', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: 60, bottom: 25 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })

    test('the bottom-cold start waits for the cap too', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.run(5 * MIN, { main: 8000 })
      boiler.temperatures({ top: 60, bottom: 25 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_main_power' })
    })

    test('the floor heating inside the night hold waits', () => {
      const boiler = startAt('2026-11-02T21:30:00+02:00')
      boiler.dishwasher(1200)
      boiler.temperatures({ top: 38 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })

    test('the top-cold emergency is never gated', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.run(5 * MIN, { main: 9000 })
      boiler.dishwasher(1200)
      boiler.temperatures({ top: 25 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'emergency_heating_top_cold' })
    })

    test('the overheat shut-off is never gated', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: 90 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'safety_shutoff_overheated' })
    })

    test('manual on is not gated', () => {
      const boiler = startAt(AFTER_HOLD, { controlMode: 'manual_on' })
      boiler.dishwasher(1200)
      boiler.mainPower(9000)
      boiler.temperatures({ top: 60 })
      expect(boiler.relay()).toMatchObject({ state: true })
      expect(boiler.relay().reason).toMatch(/^manual_on/)
    })

    test('vacation mode is not changed', () => {
      const boiler = startAt(AFTER_HOLD, { controlMode: 'vacation_3d' })
      boiler.dishwasher(1200)
      boiler.temperatures({ top: 25 })
      expect(boiler.relay().reason).toMatch(/^vacation_3d/)
      expect(boiler.relay().state).toBe(false)
    })
  })

  describe('re-evaluation', () => {
    test('a gate that opens starts the element on the reading that opens it', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200, Date.now() - 5 * MIN)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay().reason).toBe('load_wait_dishwasher')
      // No new temperature arrives: only power readings and the clock move.
      for (let i = 0; i < 5 * 60 + 2; i++) {
        jest.setSystemTime(Date.now() + 1000)
        boiler.dishwasher(0)
      }
      expect(boiler.relay()).toMatchObject({ state: true })
    })

    test('readings that do not change the gate state publish nothing', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      const count = boiler.relayCount()
      for (let i = 0; i < 60; i++) {
        jest.setSystemTime(Date.now() + 1000)
        boiler.dishwasher(1300)
        boiler.mainPower(1000)
      }
      expect(boiler.relayCount()).toBe(count)
    })
  })

  describe('start offset (T + 15 min)', () => {
    const heating = { state: true, reason: 'comfort_heating_insufficient' }
    const decide = (localIso) => {
      const boiler = startAt(localIso)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      return boiler.relay()
    }

    test('winter: no start before 22:15, start at 22:15', () => {
      expect(decide('2026-11-02T22:14:59+02:00')).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      expect(decide('2026-11-02T22:15:00+02:00')).toMatchObject(heating)
    })

    test('summer: no start before 23:15, start at 23:15', () => {
      expect(decide('2026-07-15T23:14:59+03:00')).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      expect(decide('2026-07-15T23:15:00+03:00')).toMatchObject(heating)
    })
  })

  describe('status', () => {
    test('publishes the load inputs with the existing fields unchanged', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.mainPower(2000.4)
      boiler.mainPower(3000)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.status()).toMatchObject({
        heaterState: false,
        reason: 'load_wait_dishwasher',
        controlMode: 'automatic',
        solarCirculation: false,
        temperatures: { top: COLD_ENOUGH_TO_HEAT, bottom: 35 },
        load: { mainPowerMeanW: 2500, dishwasherRunning: true, capIgnored: false }
      })
    })

    test('reports no mean and an ignored cap without main readings', () => {
      const boiler = startAt(AFTER_HOLD)
      boiler.temperatures({ top: 55 })
      expect(boiler.status().load).toEqual({ mainPowerMeanW: null, dishwasherRunning: false, capIgnored: true })
    })
  })

  describe('without topics', () => {
    test('the gates are off', () => {
      const { dishwasherTopic, mainPowerTopic, ...rest } = CONFIG
      const boiler = startAt(AFTER_HOLD, { config: rest })
      boiler.temperatures({ top: COLD_ENOUGH_TO_HEAT })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    })
  })
})
