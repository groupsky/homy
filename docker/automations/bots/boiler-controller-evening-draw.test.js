const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live windows, targets
// and draw-detection values (#1911).
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

// Times are local wall-clock times with their offset written out: +02:00 is
// winter time (EET) and +03:00 is summer time (EEST) in Europe/Sofia.
const startAt = (localIso, config = CONFIG) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload) => {
      published.push({ topic, payload })
      // The relay reader reports each command back as the contactor state, as
      // on the bus (#1912).
      if (topic === config.boilerRelayTopic && config.contactorStatusTopic) {
        subscriptions.get(config.contactorStatusTopic)?.({ state: payload.state })
      }
    }
  }
  const httpPost = async () => ({ ok: true })
  require('./boiler-controller')('boiler', { ...config, verbose: false, httpPost }).start({
    mqtt,
    persistedCache: { controlMode: 'automatic', manualOverrideExpires: null }
  })
  // The contactor status is retained, so it comes at once after the start.
  if (config.contactorStatusTopic) subscriptions.get(config.contactorStatusTopic)({ state: false })
  const deliver = (topic, payload) => {
    const callback = subscriptions.get(topic)
    if (typeof callback !== 'function') throw new Error(`no subscription for ${topic}`)
    callback(payload)
  }
  let lastTop = null
  return {
    top: (state) => { lastTop = state; deliver(config.temperatureTopTopic, { state }) },
    // The last top again, so a long test keeps the top reading fresh.
    sameTop: () => deliver(config.temperatureTopTopic, { state: lastTop }),
    bottom: (state) => deliver(config.temperatureBottomTopic, { state }),
    temperatures: ({ top, bottom = 45 }) => {
      deliver(config.temperatureBottomTopic, { state: bottom })
      lastTop = top
      deliver(config.temperatureTopTopic, { state: top })
    },
    dishwasher: (p) => deliver(config.dishwasherTopic, { p }),
    mode: (mode) => deliver(config.controlModeTopic, mode),
    at: (localIso) => jest.setSystemTime(new Date(localIso)),
    relay: () => published.filter(m => m.topic === config.boilerRelayTopic).at(-1).payload
  }
}

const decisionAt = (localIso, temperatures, config = CONFIG) => {
  const boiler = startAt(localIso, config)
  boiler.temperatures(temperatures)
  return boiler.relay()
}

describe('boiler-controller evening draw rules (#1911)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('the committed config keeps 55 °C as the limit', () => {
    expect(CONFIG.hotWaterLimit).toBe(55)
    expect(CONFIG.nightBoostTarget).toBeLessThanOrEqual(55)
    expect(CONFIG.dayTopUp.target).toBeLessThanOrEqual(55)
  })

  describe('day-zone top-up before the hold', () => {
    test('winter: starts at 19:30, not before', () => {
      expect(decisionAt('2026-11-02T19:29:00+02:00', { top: 49 }))
        .toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
      expect(decisionAt('2026-11-02T19:30:00+02:00', { top: 49 }))
        .toMatchObject({ state: true, reason: 'day_top_up' })
    })

    test('summer: starts at 20:30, one hour before the 22:00 hold', () => {
      expect(decisionAt('2026-07-15T20:29:00+03:00', { top: 49 }))
        .toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
      expect(decisionAt('2026-07-15T20:30:00+03:00', { top: 49 }))
        .toMatchObject({ state: true, reason: 'day_top_up' })
    })

    test('heats to 55 °C, then waits for the top to fall under 52 °C', () => {
      const boiler = startAt('2026-11-02T19:30:00+02:00')
      boiler.temperatures({ top: 49 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'day_top_up' })
      boiler.top(54.9)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'day_top_up' })
      boiler.top(55)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'day_top_up_reached' })
      // The reading jitters by 0.1 K around the target: no restart.
      boiler.top(54.9)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'day_top_up_reached' })
      boiler.top(52)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'day_top_up_reached' })
      boiler.top(51.9)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'day_top_up' })
    })

    test('the hold at 21:00 stops a top-up that has not reached the target', () => {
      const boiler = startAt('2026-11-02T20:50:00+02:00')
      boiler.temperatures({ top: 53 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'day_top_up' })
      boiler.at('2026-11-02T21:00:00+02:00')
      boiler.top(53.5)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
    })

    test('a top under comfortMin heats on through the top-up to 55 °C', () => {
      const boiler = startAt('2026-11-02T19:40:00+02:00')
      boiler.temperatures({ top: 45 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
      boiler.top(51)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'day_top_up' })
    })

    test('the load gates apply to its start', () => {
      const boiler = startAt('2026-11-02T19:30:00+02:00')
      boiler.dishwasher(1500)
      boiler.temperatures({ top: 49 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })
  })

  describe('night-zone boost after the hold', () => {
    test('winter: still held at 22:14, boosts from 22:15', () => {
      expect(decisionAt('2026-11-02T22:14:00+02:00', { top: 54 }))
        .toMatchObject({ state: false, reason: 'night_tariff_hold' })
      expect(decisionAt('2026-11-02T22:15:00+02:00', { top: 54 }))
        .toMatchObject({ state: true, reason: 'night_boost' })
    })

    test('summer: boosts from 23:15', () => {
      expect(decisionAt('2026-07-15T23:14:00+03:00', { top: 54 }))
        .toMatchObject({ state: false, reason: 'night_tariff_hold' })
      expect(decisionAt('2026-07-15T23:15:00+03:00', { top: 54 }))
        .toMatchObject({ state: true, reason: 'night_boost' })
    })

    // The first start of a window ignores the hysteresis band: a top of 54 °C
    // after the hold still gets its boost.
    test('the first boost after the hold starts in the hysteresis band', () => {
      const boiler = startAt('2026-11-02T22:10:00+02:00')
      boiler.temperatures({ top: 54 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      boiler.at('2026-11-02T22:15:10+02:00')
      boiler.top(54)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'night_boost' })
      boiler.top(55)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
      boiler.top(54.9)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
      boiler.top(51.9)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'night_boost' })
    })

    test('a top at 55 °C when the hold ends is not heated', () => {
      expect(decisionAt('2026-11-02T22:15:00+02:00', { top: 55 }))
        .toMatchObject({ state: false, reason: 'night_boost_reached' })
    })

    test('lasts to the end of the night zone (06:00 in winter)', () => {
      expect(decisionAt('2026-11-03T05:59:00+02:00', { top: 51 }))
        .toMatchObject({ state: true, reason: 'night_boost' })
      expect(decisionAt('2026-11-03T06:00:00+02:00', { top: 51 }))
        .toMatchObject({ state: false, reason: 'temperature_sufficient' })
    })

    test('the boost runs past midnight', () => {
      expect(decisionAt('2026-11-03T00:30:00+02:00', { top: 51 }))
        .toMatchObject({ state: true, reason: 'night_boost' })
    })

    test('no boost or top-up in the middle of the day', () => {
      expect(decisionAt('2026-11-02T12:00:00+02:00', { top: 51 }))
        .toMatchObject({ state: false, reason: 'temperature_sufficient' })
    })
  })

  describe('the windows follow the zone change on 1 April and 1 November', () => {
    test('31 October: summer windows (top-up 20:30, boost 23:15)', () => {
      expect(decisionAt('2026-10-31T19:30:00+02:00', { top: 49 })).toMatchObject({ reason: 'hysteresis_zone_maintain_false' })
      expect(decisionAt('2026-10-31T20:30:00+02:00', { top: 49 })).toMatchObject({ reason: 'day_top_up' })
      expect(decisionAt('2026-10-31T22:20:00+02:00', { top: 49 })).toMatchObject({ reason: 'night_tariff_hold' })
      expect(decisionAt('2026-10-31T23:15:00+02:00', { top: 49 })).toMatchObject({ reason: 'night_boost' })
    })

    test('1 November: winter windows (top-up 19:30, boost 22:15)', () => {
      expect(decisionAt('2026-11-01T19:30:00+02:00', { top: 49 })).toMatchObject({ reason: 'day_top_up' })
      expect(decisionAt('2026-11-01T22:15:00+02:00', { top: 49 })).toMatchObject({ reason: 'night_boost' })
    })

    test('31 March: winter windows; 1 April: summer windows', () => {
      expect(decisionAt('2026-03-31T19:30:00+03:00', { top: 49 })).toMatchObject({ reason: 'day_top_up' })
      expect(decisionAt('2026-03-31T22:15:00+03:00', { top: 49 })).toMatchObject({ reason: 'night_boost' })
      expect(decisionAt('2026-04-01T19:30:00+03:00', { top: 49 })).toMatchObject({ reason: 'hysteresis_zone_maintain_false' })
      expect(decisionAt('2026-04-01T20:30:00+03:00', { top: 49 })).toMatchObject({ reason: 'day_top_up' })
      expect(decisionAt('2026-04-01T22:15:00+03:00', { top: 49 })).toMatchObject({ reason: 'night_tariff_hold' })
    })
  })

  describe('the 55 °C limit', () => {
    test('a higher boost or top-up target is capped at hotWaterLimit', () => {
      const config = { ...CONFIG, nightBoostTarget: 70, dayTopUp: { minutesBeforeHold: 90, target: 70 } }
      expect(decisionAt('2026-11-02T22:30:00+02:00', { top: 55 }, config))
        .toMatchObject({ state: false, reason: 'night_boost_reached' })
      expect(decisionAt('2026-11-02T19:45:00+02:00', { top: 55 }, config))
        .toMatchObject({ state: false, reason: 'day_top_up_reached' })
    })

    test('maxSafe and the emergency rules are unchanged', () => {
      expect(decisionAt('2026-11-02T22:30:00+02:00', { top: 29 }))
        .toMatchObject({ state: true, reason: 'emergency_heating_top_cold' })
      expect(decisionAt('2026-11-02T22:30:00+02:00', { top: 54, bottom: 29 }))
        .toMatchObject({ state: true, reason: 'emergency_heating_bottom_cold' })
      expect(decisionAt('2026-11-02T22:30:00+02:00', { top: 85 }))
        .toMatchObject({ state: false, reason: 'safety_shutoff_overheated' })
    })
  })

  describe('start on a draw', () => {
    // A bottom reading every minute, falling `step` K each time, from `from`,
    // each followed by the same top reading.
    const fall = (boiler, startIso, from, steps, step) => {
      const t0 = new Date(startIso).getTime()
      for (let i = 0; i <= steps; i++) {
        jest.setSystemTime(t0 + i * 60 * 1000)
        boiler.bottom(Math.round((from - i * step) * 10) / 10)
        boiler.sameTop()
      }
    }

    test('a fall of 3 K within 10 min starts the element, 2.9 K does not', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.temperatures({ top: 48.5, bottom: 47.6 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
      boiler.at('2026-11-02T14:05:00+02:00')
      boiler.bottom(44.7)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
      boiler.at('2026-11-02T14:06:00+02:00')
      boiler.bottom(44.6)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
    })

    test('a slow fall (3 K in 15 min) does not count', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.temperatures({ top: 48.5, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 15, 0.2)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    })

    test('in the day zone it heats the top to comfortMin + hysteresis', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.temperatures({ top: 48.5, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 3, 1)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      boiler.top(49.9)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      boiler.top(50)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'temperature_sufficient' })
      // The latch is gone: the band keeps it off again.
      boiler.top(49.5)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    })

    test('after the boost reached 55 °C, a draw starts the element again', () => {
      const boiler = startAt('2026-11-02T22:30:00+02:00')
      boiler.temperatures({ top: 55, bottom: 52 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
      boiler.top(54.5)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
      fall(boiler, '2026-11-02T22:31:00+02:00', 52, 3, 1)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      boiler.top(55)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
    })

    test('a draw seen with the top at the target waits for the top to fall under it', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.temperatures({ top: 50, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 4, 1)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'temperature_sufficient' })
      boiler.at('2026-11-02T14:20:00+02:00')
      boiler.bottom(42)
      boiler.top(49.9)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
    })

    test('a waiting draw is dropped after 30 min', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.temperatures({ top: 50, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 4, 1)
      boiler.at('2026-11-02T14:35:00+02:00')
      boiler.bottom(43)
      boiler.top(49.9)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    })

    // The first fall of a bath comes while the top is still at 55 °C after the
    // boost. It must not be used up: the element starts when the top falls.
    test('after the boost, the first fall of a draw starts the element once the top falls', () => {
      const boiler = startAt('2026-11-02T22:40:00+02:00')
      boiler.temperatures({ top: 55, bottom: 52 })
      fall(boiler, '2026-11-02T22:40:00+02:00', 52, 3, 1)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
      boiler.top(54.9)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      boiler.top(55)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
      // The draw is done with; the jitter does not switch the element again.
      boiler.top(54.9)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_boost_reached' })
    })

    test('a start the load gates hold back for over 30 min is dropped', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.dishwasher(1500)
      boiler.temperatures({ top: 48.5, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 3, 1)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
      // The dishwasher stops; 35 min after the draw the gate opens.
      boiler.at('2026-11-02T14:35:00+02:00')
      boiler.dishwasher(0)
      boiler.at('2026-11-02T14:46:00+02:00')
      boiler.dishwasher(0)
      boiler.bottom(44)
      boiler.top(48.4)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    })

    test('the night hold still applies; the boost starts at 22:15', () => {
      const boiler = startAt('2026-11-02T21:40:00+02:00')
      boiler.temperatures({ top: 54, bottom: 52 })
      fall(boiler, '2026-11-02T21:40:00+02:00', 52, 4, 1)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      boiler.at('2026-11-02T22:15:00+02:00')
      boiler.bottom(46)
      boiler.top(53.5)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'night_boost' })
    })

    test('the load gates apply to its start', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.dishwasher(1500)
      boiler.temperatures({ top: 48.5, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 3, 1)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
    })

    test('a manual mode clears a draw seen before it', () => {
      const boiler = startAt('2026-11-02T14:00:00+02:00')
      boiler.temperatures({ top: 48.5, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 3, 1)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
      boiler.mode('manual_off')
      expect(boiler.relay()).toMatchObject({ state: false })
      boiler.mode('automatic')
      boiler.top(48.4)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    })

    test('off without drawDropK', () => {
      const { drawDropK, ...config } = CONFIG
      const boiler = startAt('2026-11-02T14:00:00+02:00', config)
      boiler.temperatures({ top: 48.5, bottom: 47 })
      fall(boiler, '2026-11-02T14:00:00+02:00', 47, 5, 1)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    })
  })

  test('without the new keys the controller behaves as before', () => {
    const { nightBoostTarget, dayTopUp, drawDropK, ...config } = CONFIG
    expect(decisionAt('2026-11-02T19:45:00+02:00', { top: 49 }, config))
      .toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
    expect(decisionAt('2026-11-02T22:30:00+02:00', { top: 49 }, config))
      .toMatchObject({ state: false, reason: 'hysteresis_zone_maintain_false' })
  })
})
