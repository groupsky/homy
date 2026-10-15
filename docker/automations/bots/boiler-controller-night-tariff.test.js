const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live zone table and limits.
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

// Times in the tests are local wall-clock times with their offset written out:
// +02:00 is winter time (EET) and +03:00 is summer time (EEST) in Europe/Sofia.
// The test runner itself runs in UTC (jest.global-setup.js).
const startAt = (localIso, config = CONFIG) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload) => { published.push({ topic, payload }) }
  }
  require('./boiler-controller')('boiler', config).start({
    mqtt,
    persistedCache: { controlMode: 'automatic', manualOverrideExpires: null }
  })
  const deliver = (topic, payload) => {
    const callback = subscriptions.get(topic)
    if (typeof callback !== 'function') throw new Error(`no subscription for ${topic}`)
    callback(payload)
  }
  return {
    temperatures: ({ top, bottom = 35 }) => {
      deliver(config.temperatureBottomTopic, { state: bottom })
      deliver(config.temperatureTopTopic, { state: top })
    },
    at: (localIso) => jest.setSystemTime(new Date(localIso)),
    relay: () => published.filter(m => m.topic === config.boilerRelayTopic).at(-1).payload
  }
}

// Tank top under comfortMin (47 °C) but above the floor (40 °C): outside the
// hold this starts the element.
const WARM_ENOUGH = 45

const decisionAt = (localIso, temperatures = { top: WARM_ENOUGH }) => {
  const boiler = startAt(localIso)
  boiler.temperatures(temperatures)
  return boiler.relay()
}

const held = { state: false, reason: 'night_tariff_hold' }
const heating = { state: true, reason: 'comfort_heating_insufficient' }

describe('boiler-controller night tariff hold', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  describe('winter table (22:00 zone start)', () => {
    test('does not start in the last hour of the day zone when the top is above the floor', () => {
      expect(decisionAt('2026-11-02T21:30:00+02:00')).toMatchObject(held)
    })

    test('the hold begins one hour before the zone starts', () => {
      expect(decisionAt('2026-11-02T20:59:00+02:00')).toMatchObject(heating)
      expect(decisionAt('2026-11-02T21:00:00+02:00')).toMatchObject(held)
    })

    test('keeps the 10-minute margin after the zone starts, then allows a start', () => {
      expect(decisionAt('2026-11-02T22:05:00+02:00')).toMatchObject(held)
      expect(decisionAt('2026-11-02T22:09:59+02:00')).toMatchObject(held)
      expect(decisionAt('2026-11-02T22:10:00+02:00')).toMatchObject(heating)
    })

    test('starts the element on the first reading after the margin ends', () => {
      const boiler = startAt('2026-11-02T21:45:00+02:00')
      boiler.temperatures({ top: WARM_ENOUGH })
      expect(boiler.relay()).toMatchObject(held)

      boiler.at('2026-11-02T22:10:30+02:00')
      boiler.temperatures({ top: WARM_ENOUGH - 0.1 })
      expect(boiler.relay()).toMatchObject(heating)
    })

    test('stops an element that is still running when the hold begins', () => {
      const boiler = startAt('2026-11-02T20:50:00+02:00')
      boiler.temperatures({ top: WARM_ENOUGH })
      expect(boiler.relay()).toMatchObject(heating)

      boiler.at('2026-11-02T21:00:30+02:00')
      boiler.temperatures({ top: WARM_ENOUGH + 0.5 })
      expect(boiler.relay()).toMatchObject(held)
    })

    test('the floor releases the element when the top is under 40 °C', () => {
      expect(decisionAt('2026-11-02T21:30:00+02:00', { top: 39.9 })).toMatchObject(heating)
      expect(decisionAt('2026-11-02T21:30:00+02:00', { top: 40 })).toMatchObject(held)
    })

    // The top reading jitters by 0.1 K. Without hysteresis at the floor the
    // contactor would switch every few seconds around 40 °C.
    test('an element released by the floor runs on to the floor plus the hysteresis', () => {
      const boiler = startAt('2026-11-02T21:30:00+02:00')
      boiler.temperatures({ top: 39.9 })
      expect(boiler.relay()).toMatchObject(heating)
      boiler.temperatures({ top: 40 })
      expect(boiler.relay()).toMatchObject(heating)
      boiler.temperatures({ top: 42.9 })
      expect(boiler.relay()).toMatchObject(heating)
      boiler.temperatures({ top: 43 })
      expect(boiler.relay()).toMatchObject(held)
      boiler.temperatures({ top: 42.9 })
      expect(boiler.relay()).toMatchObject(held)
    })
  })

  describe('summer table (23:00 zone start)', () => {
    test('allows a start before the hold and holds from 22:00 to 23:10', () => {
      expect(decisionAt('2026-07-15T21:55:00+03:00')).toMatchObject(heating)
      expect(decisionAt('2026-07-15T22:00:00+03:00')).toMatchObject(held)
      expect(decisionAt('2026-07-15T23:05:00+03:00')).toMatchObject(held)
      expect(decisionAt('2026-07-15T23:10:00+03:00')).toMatchObject(heating)
    })
  })

  describe('the table switches on 1 April and 1 November, not on the clock-change days', () => {
    test('31 March still uses the winter zone start', () => {
      expect(decisionAt('2026-03-31T22:30:00+03:00')).toMatchObject(heating)
    })

    test('1 April uses the summer zone start', () => {
      expect(decisionAt('2026-04-01T22:30:00+03:00')).toMatchObject(held)
    })

    test('31 October still uses the summer zone start', () => {
      expect(decisionAt('2026-10-31T22:30:00+02:00')).toMatchObject(held)
    })

    test('1 November uses the winter zone start', () => {
      expect(decisionAt('2026-11-01T22:30:00+02:00')).toMatchObject(heating)
    })
  })

  describe('clock changes follow the local wall clock', () => {
    // Summer time starts on 2026-03-29 at 03:00 local. The zone still starts at
    // 22:00 on the wall clock, which is 19:00 UTC that evening and 20:00 UTC the
    // evening before. A fixed UTC+2 offset would put the hold an hour late.
    test('2026-03-29: the hold is 21:00-22:10 on the new summer clock', () => {
      expect(decisionAt('2026-03-28T21:05:00+02:00')).toMatchObject(held)
      expect(decisionAt('2026-03-29T20:55:00+03:00')).toMatchObject(heating)
      expect(decisionAt('2026-03-29T21:05:00+03:00')).toMatchObject(held)
      expect(decisionAt('2026-03-29T22:10:00+03:00')).toMatchObject(heating)
    })

    // Summer time ends on 2026-10-25 at 04:00 local. October keeps the 23:00
    // zone start until 31 October, now on the winter clock. A fixed UTC+3 offset
    // would put the hold an hour early.
    test('2026-10-25: the hold is 22:00-23:10 on the new winter clock', () => {
      expect(decisionAt('2026-10-24T22:05:00+03:00')).toMatchObject(held)
      expect(decisionAt('2026-10-25T21:55:00+02:00')).toMatchObject(heating)
      expect(decisionAt('2026-10-25T22:05:00+02:00')).toMatchObject(held)
      expect(decisionAt('2026-10-25T23:10:00+02:00')).toMatchObject(heating)
    })
  })

  describe('the cold-tank emergency rule is unchanged', () => {
    test('a tank bottom under 30 °C at midday starts the element', () => {
      expect(decisionAt('2026-11-02T12:00:00+02:00', { top: 55, bottom: 29 }))
        .toMatchObject({ state: true, reason: 'emergency_heating_bottom_cold' })
    })

    test('a tank bottom under 30 °C starts the element inside the hold too', () => {
      expect(decisionAt('2026-11-02T21:30:00+02:00', { top: 55, bottom: 29 }))
        .toMatchObject({ state: true, reason: 'emergency_heating_bottom_cold' })
    })
  })

  test('without a nightTariff config the controller never holds', () => {
    const { nightTariff, ...withoutTariff } = CONFIG
    const boiler = startAt('2026-11-02T21:30:00+02:00', withoutTariff)
    boiler.temperatures({ top: WARM_ENOUGH })
    expect(boiler.relay()).toMatchObject(heating)
  })
})
