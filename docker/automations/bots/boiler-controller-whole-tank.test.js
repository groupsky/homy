const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live limits (#1976).
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

const MIN = 60 * 1000

// Local wall-clock times with their offset: +02:00 is winter (Europe/Sofia).
// Winter hold: 21:00-22:15.
const DAY = '2026-11-05T14:00:00+02:00'
const IN_HOLD = '2026-11-05T21:30:00+02:00'

const startAt = (localIso, { config = CONFIG, controlMode = 'automatic' } = {}) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload) => {
      published.push({ topic, payload })
      // The relay reader reports each command back as the contactor state.
      if (topic === config.boilerRelayTopic && config.contactorStatusTopic) {
        const echoTo = subscriptions.get(config.contactorStatusTopic)
        if (typeof echoTo === 'function') echoTo({ state: payload.state })
      }
    }
  }
  const persistedCache = {
    controlMode,
    manualOverrideExpires: controlMode === 'automatic' ? null : Date.now() + 24 * 60 * MIN
  }
  require('./boiler-controller')('boiler', { ...config, verbose: false, httpPost: async () => ({ ok: true }) })
    .start({ mqtt, persistedCache })
  // The contactor status is retained, so it comes at once after the start.
  const retained = config.contactorStatusTopic && subscriptions.get(config.contactorStatusTopic)
  if (typeof retained === 'function') retained({ state: false })
  const deliver = (topic, payload) => {
    const callback = subscriptions.get(topic)
    if (typeof callback !== 'function') throw new Error(`no subscription for ${topic}`)
    callback(payload)
  }
  const boiler = {
    temperatures: ({ top, bottom }) => {
      deliver(config.temperatureBottomTopic, { state: bottom, _tz: Date.now() })
      deliver(config.temperatureTopTopic, { state: top, _tz: Date.now() })
    },
    // Advances the clock in 30 s steps with fresh temperatures.
    run: (ms, temperatures) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 30 * 1000) {
        jest.setSystemTime(Date.now() + 30 * 1000)
        boiler.temperatures(temperatures)
      }
    },
    mainPower: (total_p) => deliver(config.mainPowerTopic, { total_p, _tz: Date.now() }),
    dishwasher: (p) => deliver(config.dishwasherTopic, { p, _tz: Date.now() }),
    at: (localIso) => jest.setSystemTime(new Date(localIso)),
    mode: (payload) => deliver(config.controlModeTopic, payload),
    relay: () => published.filter(m => m.topic === config.boilerRelayTopic).at(-1).payload,
    modeStatus: () => published.filter(m => m.topic === config.controlModeStatusTopic).at(-1).payload,
    persistedCache
  }
  return boiler
}

describe('boiler-controller: heat during the evening baths and the whole tank (#1976)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('the committed config has the boost limits; the automatic rules keep 55 °C', () => {
    expect(CONFIG).toMatchObject({ boostBottomTarget: 50, boostTopLimit: 60, hotWaterLimit: 55 })
    expect(CONFIG.boostTopLimit).toBeLessThan(CONFIG.maxSafe)
  })

  describe('a draw during the night-tariff hold', () => {
    // A fall of the bottom reading of 3.5 K within 2 minutes is a draw.
    const draw = (boiler, top) => {
      boiler.at('2026-11-05T21:32:00+02:00')
      boiler.temperatures({ top, bottom: 41.5 })
    }

    test('starts the element and heats the top to the draw target, then the hold is back', () => {
      const boiler = startAt(IN_HOLD)
      boiler.temperatures({ top: 48, bottom: 45 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      draw(boiler, 48)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      boiler.temperatures({ top: 49.9, bottom: 40 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      // The draw target outside the top-up and boost windows: comfortMin + hysteresis
      boiler.temperatures({ top: 50, bottom: 40 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      boiler.temperatures({ top: 49, bottom: 40 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
    })

    test('the dishwasher gate holds it back', () => {
      const boiler = startAt(IN_HOLD)
      boiler.dishwasher(1200)
      boiler.temperatures({ top: 48, bottom: 45 })
      draw(boiler, 48)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })

    test('the main power gate holds it back', () => {
      const boiler = startAt(IN_HOLD)
      boiler.mainPower(9000)
      boiler.temperatures({ top: 48, bottom: 45 })
      draw(boiler, 48)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_main_power' })
    })

    test('with the top at the draw target it waits; the hold stays', () => {
      const boiler = startAt(IN_HOLD)
      boiler.temperatures({ top: 52, bottom: 45 })
      draw(boiler, 52)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
    })

    test('old temperatures still stop it', () => {
      const boiler = startAt(IN_HOLD)
      boiler.temperatures({ top: 48, bottom: 45 })
      draw(boiler, 48)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      jest.advanceTimersByTime(11 * MIN)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'input_stale' })
    })
  })

  describe('boost heats the whole tank', () => {
    test('starts with the top over 55 °C and a cold bottom, and runs until the bottom is at 50 °C', () => {
      const boiler = startAt(DAY)
      boiler.temperatures({ top: 56.2, bottom: 43 })
      boiler.mode({ mode: 'boost', _src: 'ha' })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'manual_boost' })
      boiler.temperatures({ top: 58, bottom: 49.9 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'manual_boost' })
      boiler.temperatures({ top: 58, bottom: 50 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'temperature_sufficient' })
      expect(boiler.modeStatus()).toMatchObject({ mode: 'automatic', manualOverrideExpires: null })
    })

    test('stops early when the top reaches 60 °C', () => {
      const boiler = startAt(DAY)
      boiler.temperatures({ top: 50, bottom: 40 })
      boiler.mode('boost')
      boiler.temperatures({ top: 59.9, bottom: 45 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'manual_boost' })
      boiler.temperatures({ top: 60, bottom: 45 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'temperature_sufficient' })
      expect(boiler.modeStatus().mode).toBe('automatic')
    })

    test('stops after 2 h', () => {
      const boiler = startAt(DAY)
      boiler.temperatures({ top: 56, bottom: 40 })
      boiler.mode('boost')
      boiler.run(119 * MIN, { top: 56, bottom: 40 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'manual_boost' })
      boiler.run(MIN, { top: 56, bottom: 40 })
      expect(boiler.modeStatus().mode).toBe('automatic')
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'temperature_sufficient' })
    })

    test('ignores the night hold and the load gates', () => {
      const boiler = startAt(IN_HOLD)
      boiler.dishwasher(1200)
      boiler.mainPower(9000)
      boiler.temperatures({ top: 56, bottom: 44 })
      boiler.mode('boost')
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'manual_boost' })
    })

    test('old temperatures and maxSafe stop it', () => {
      const boiler = startAt(DAY)
      boiler.temperatures({ top: 56, bottom: 40 })
      boiler.mode('boost')
      jest.advanceTimersByTime(11 * MIN)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'input_stale' })

      const hot = startAt(DAY, { config: { ...CONFIG, maxSafe: 58 } })
      hot.temperatures({ top: 56, bottom: 40 })
      hot.mode('boost')
      hot.temperatures({ top: 58, bottom: 41 })
      expect(hot.relay()).toMatchObject({ state: false, reason: 'safety_shutoff_overheated' })
      expect(hot.modeStatus().mode).toBe('automatic')
    })
  })

  describe('boost refusals', () => {
    test.each([
      ['the bottom at the target', { top: 55, bottom: 50 }, 'bottom_at_target'],
      ['the bottom over the target', { top: 52, bottom: 53.4 }, 'bottom_at_target'],
      ['the top at the limit', { top: 60, bottom: 40 }, 'top_at_limit'],
      ['both at their limits', { top: 61, bottom: 52 }, 'top_at_limit']
    ])('is refused with %s', (_, temperatures, reason) => {
      const boiler = startAt(DAY)
      boiler.temperatures(temperatures)
      boiler.mode('boost')
      expect(boiler.persistedCache.controlMode).toBe('automatic')
      expect(boiler.modeStatus()).toMatchObject({
        mode: 'automatic',
        lastCommand: {
          mode: 'boost',
          result: 'refused',
          reason,
          top: temperatures.top,
          bottom: temperatures.bottom,
          limit: 60,
          bottomTarget: 50
        }
      })
    })

    test('is applied with the top at 56.2 °C and the bottom at 43 °C (2026-11-19)', () => {
      const boiler = startAt(DAY)
      boiler.temperatures({ top: 56.2, bottom: 43 })
      boiler.mode('boost')
      expect(boiler.modeStatus()).toMatchObject({
        mode: 'boost',
        lastCommand: { mode: 'boost', result: 'applied', reason: 'ok', top: 56.2, bottom: 43 }
      })
    })
  })

  describe('manual_on uses the same limits', () => {
    test('heats while the bottom is under 50 °C; starts again under 47 °C', () => {
      const boiler = startAt(DAY, { controlMode: 'manual_on' })
      boiler.temperatures({ top: 56.2, bottom: 43 })
      expect(boiler.relay().state).toBe(true)
      expect(boiler.relay().reason).toMatch(/^manual_on \(/)
      boiler.temperatures({ top: 58, bottom: 50 })
      expect(boiler.relay().state).toBe(false)
      expect(boiler.relay().reason).toMatch(/^manual_on_limit_reached/)
      boiler.temperatures({ top: 55, bottom: 47 })
      expect(boiler.relay().state).toBe(false)
      boiler.temperatures({ top: 55, bottom: 46.9 })
      expect(boiler.relay().state).toBe(true)
      expect(boiler.modeStatus().mode).toBe('manual_on')
    })

    test('never above 60 °C at the top; starts again under 57 °C', () => {
      const boiler = startAt(DAY, { controlMode: 'manual_on' })
      boiler.temperatures({ top: 59.9, bottom: 40 })
      expect(boiler.relay().state).toBe(true)
      boiler.temperatures({ top: 60, bottom: 40 })
      expect(boiler.relay().state).toBe(false)
      expect(boiler.relay().reason).toMatch(/^manual_on_limit_reached/)
      boiler.temperatures({ top: 57, bottom: 40 })
      expect(boiler.relay().state).toBe(false)
      boiler.temperatures({ top: 56.9, bottom: 40 })
      expect(boiler.relay().state).toBe(true)
    })

    test('maxSafe stops it', () => {
      const boiler = startAt(DAY, { controlMode: 'manual_on', config: { ...CONFIG, maxSafe: 58 } })
      boiler.temperatures({ top: 58, bottom: 40 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'safety_shutoff_overheated' })
    })

    test('with the bottom at the target it is applied with reason bottom_at_target', () => {
      const boiler = startAt(DAY)
      boiler.temperatures({ top: 52, bottom: 51 })
      boiler.mode('manual_on')
      expect(boiler.persistedCache.controlMode).toBe('manual_on')
      expect(boiler.relay().state).toBe(false)
      expect(boiler.modeStatus().lastCommand).toMatchObject({
        mode: 'manual_on', result: 'applied', reason: 'bottom_at_target', top: 52, bottom: 51
      })
    })
  })
})
