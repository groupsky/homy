const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')
const boilerPlan = require('../lib/boiler-plan')

// The committed bot config, so these tests check the live plan values (#1985).
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController
const PLAN = CONFIG.eveningPlan

const MIN = 60 * 1000
const HOUR = 60 * MIN

// Local wall-clock times with their offset: +02:00 is winter time in Sofia.
// 2026-11-23 is a Monday (winter table: 2.4 baths), 2026-11-28 a Saturday
// (1.5 baths). Cold water in November: 14.6 °C. The winter night zone is
// 22:00-06:00; the hold 21:00-22:15.
const MONDAY = '2026-11-23'
const SATURDAY = '2026-11-28'
const at = (date, hhmm) => `${date}T${hhmm}:00+02:00`

const startAt = (localIso, { config = CONFIG, persisted = {} } = {}) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  let temps = null
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload, options) => {
      published.push({ topic, payload, options })
      // The relay reader reports each command back as the contactor state.
      if (topic === config.boilerRelayTopic) {
        const echoTo = subscriptions.get(config.contactorStatusTopic)
        if (typeof echoTo === 'function') echoTo({ state: payload.state })
      }
    }
  }
  const persistedCache = { controlMode: 'automatic', manualOverrideExpires: null, ...persisted }
  require('./boiler-controller')('boilerController', {
    ...config,
    verbose: false,
    httpPost: jest.fn().mockResolvedValue({ ok: true })
  }).start({ mqtt, persistedCache })
  const deliver = (topic, payload) => {
    const callback = subscriptions.get(topic)
    if (typeof callback !== 'function') throw new Error(`no subscription for ${topic}`)
    callback(payload)
  }
  deliver(config.contactorStatusTopic, { state: false })
  const boiler = {
    persistedCache,
    temperatures: ({ top, bottom }) => {
      temps = { top, bottom }
      deliver(config.temperatureBottomTopic, { state: bottom })
      deliver(config.temperatureTopTopic, { state: top })
    },
    meter: (tot) => deliver(PLAN.boilerMeterTopic, { tot, _tz: Date.now() }),
    dishwasher: (p) => deliver(config.dishwasherTopic, { p, _tz: Date.now() }),
    override: (value) => deliver(PLAN.overrideSetTopic, value),
    // Moves the clock on in steps of one minute; the readings stay fresh.
    // each(minute) may return new temperatures.
    run: (ms, each) => {
      for (let t = 0; t < ms; t += MIN) {
        jest.advanceTimersByTime(MIN)
        const next = each ? each(t + MIN) : null
        boiler.temperatures(next || temps)
      }
    },
    relay: () => published.filter(m => m.topic === config.boilerRelayTopic).at(-1)?.payload,
    status: () => published.filter(m => m.topic === config.automationStatusTopic).at(-1).payload,
    overrideStatus: () => published.filter(m => m.topic === PLAN.overrideStatusTopic).at(-1),
    mainPower: (w) => deliver(config.mainPowerTopic, { total_p: w, _tz: Date.now() }),
    // The status now, without waiting for a change or a heartbeat: the
    // override topic answers with a status, so the same value is sent again.
    statusNow: () => {
      boiler.override(persistedCache.eveningOverride ? persistedCache.eveningOverride.baths : '')
      return boiler.status()
    }
  }
  return boiler
}

// Four Mondays before MONDAY with these baths
const mondays = (values) => Object.fromEntries(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']
  .map((date, i) => [date, values[i]]))

describe('boiler-controller evening plan (#1985)', () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('the committed config sets the plan values', () => {
    expect(PLAN).toMatchObject({
      marginBaths: 1,
      eveningStart: '19:30',
      nightLimit: 55,
      dayLimit: 55,
      measureFrom: '18:00',
      standbyW: 40,
      sameWeekdays: 4,
      boilerMeterTopic: '/modbus/secondary/boiler/reading'
    })
    expect(PLAN.nightLimit).toBeLessThanOrEqual(CONFIG.hotWaterLimit)
    expect(PLAN.dayLimit).toBeLessThanOrEqual(CONFIG.hotWaterLimit)
    // The fixed windows of #1911 are replaced by the plan
    expect(CONFIG.dayTopUp).toBeUndefined()
    expect(CONFIG.nightBoostTarget).toBeUndefined()
  })

  describe('the evening use is measured and kept', () => {
    test('a recorded evening: 55/50 °C at 18:00, 40/20 °C at 24:00, 6.5 kWh on the meter', () => {
      const boiler = startAt(at(MONDAY, '17:55'))
      boiler.temperatures({ top: 55, bottom: 50 })
      boiler.meter(1000)
      // 18:00 to 23:50: the meter counts 6.5 kWh; the tank cools to 40/20
      boiler.run(6 * HOUR + 10 * MIN, (t) => {
        const minutesAfter1800 = t / MIN - 5
        if (minutesAfter1800 > 0 && minutesAfter1800 % 5 === 0) boiler.meter(1000 + Math.min(6.5, 6.5 * minutesAfter1800 / 350))
        return minutesAfter1800 >= 300 ? { top: 40, bottom: 20 } : null
      })
      const expected = boilerPlan.eveningBaths({
        start: { top: 55, bottom: 50 },
        end: { top: 40, bottom: 20 },
        elementKwh: 6.5,
        hours: 6,
        standbyW: 40,
        cold: 14.6,
        bathLitres: 65,
        bathTempC: 40
      })
      expect(expected).toBeGreaterThan(4)
      const stored = boiler.persistedCache.eveningBaths[MONDAY]
      expect(stored).toBeCloseTo(expected, 1)
      expect(boiler.statusNow().plan.lastEvening).toMatchObject({ date: MONDAY, baths: stored, elementKwh: 6.5, energySource: 'meter' })
    })

    test('without the meter: the element energy comes from the model', () => {
      const boiler = startAt(at(MONDAY, '17:55'))
      boiler.temperatures({ top: 50, bottom: 50 })
      boiler.run(6 * HOUR + 10 * MIN, (t) => t > 3 * HOUR ? { top: 40, bottom: 20 } : null)
      const last = boiler.statusNow().plan.lastEvening
      expect(last).toMatchObject({ date: MONDAY, energySource: 'model' })
      expect(boiler.persistedCache.eveningBaths[MONDAY]).toBe(last.baths)
    })

    test('a start after 18:05 (a restart) measures nothing that evening', () => {
      const boiler = startAt(at(MONDAY, '19:00'))
      boiler.temperatures({ top: 55, bottom: 50 })
      boiler.run(5 * HOUR + 10 * MIN)
      expect(boiler.persistedCache.eveningBaths?.[MONDAY]).toBeUndefined()
    })

    test('old readings at midnight: the evening is not stored', () => {
      const boiler = startAt(at(MONDAY, '17:55'))
      boiler.temperatures({ top: 55, bottom: 50 })
      boiler.run(5 * HOUR)
      // The readings stop at 22:55
      jest.advanceTimersByTime(HOUR + 15 * MIN)
      expect(boiler.persistedCache.eveningBaths?.[MONDAY]).toBeUndefined()
    })

    test('the history is kept across a restart and old evenings are dropped', () => {
      const history = { ...mondays([3, 3, 4, 4]), '2026-08-01': 2 }
      const boiler = startAt(at(MONDAY, '17:55'), { persisted: { eveningBaths: history } })
      boiler.temperatures({ top: 55, bottom: 50 })
      boiler.run(6 * HOUR + 10 * MIN)
      const kept = boiler.persistedCache.eveningBaths
      expect(Object.keys(kept).sort()).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', MONDAY])
    })
  })

  describe('the need', () => {
    test('the mean of the last 4 same weekdays', () => {
      const boiler = startAt(at(MONDAY, '12:00'), { persisted: { eveningBaths: mondays([3, 3.5, 4, 3.5]) } })
      boiler.temperatures({ top: 55, bottom: 40 })
      const plan = boiler.statusNow().plan
      expect(plan).toMatchObject({ date: MONDAY, need: 3.5, needSource: 'history', marginBaths: 1, targetBaths: 4.5 })
    })

    test('until 4 are stored: the season table', () => {
      const three = mondays([3, 3.5, 4, 3.5])
      delete three['2026-10-26']
      const boiler = startAt(at(MONDAY, '12:00'), { persisted: { eveningBaths: three } })
      boiler.temperatures({ top: 55, bottom: 40 })
      expect(boiler.statusNow().plan).toMatchObject({ need: 2.4, needSource: 'season', targetBaths: 3.4 })
    })

    test('a broken history: the season table, never no heating', () => {
      const boiler = startAt(at(MONDAY, '03:00'), { persisted: { eveningBaths: 'broken' } })
      boiler.temperatures({ top: 50, bottom: 30 })
      expect(boiler.statusNow().plan).toMatchObject({ need: 2.4, needSource: 'season' })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_night' })
    })

    test('a broken season table too: the plan fills the tank', () => {
      const config = { ...CONFIG, eveningPlan: { ...PLAN, bathsBySeason: null } }
      const boiler = startAt(at(MONDAY, '03:00'), { config })
      boiler.temperatures({ top: 50, bottom: 30 })
      const plan = boiler.statusNow().plan
      expect(plan).toMatchObject({ need: null, needSource: 'none' })
      expect(plan.targetBaths).toBe(plan.capacityBaths)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_night' })
    })
  })

  describe('heating covers only the shortfall', () => {
    test('a full tank: no heating at night or in the day', () => {
      // Saturday: need 1.5 + 1 = 2.5 baths; 54/52 °C holds more
      const night = startAt(at(SATURDAY, '03:00'))
      night.temperatures({ top: 54, bottom: 52 })
      const plan = night.statusNow().plan
      expect(plan.bathsReady).toBeGreaterThan(plan.targetBaths)
      expect(plan).toMatchObject({ shortfallBaths: 0, nextStart: null })
      expect(night.relay()).toMatchObject({ state: false, reason: 'plan_night_met' })
      jest.clearAllTimers()

      const day = startAt(at(SATURDAY, '12:00'))
      day.temperatures({ top: 54, bottom: 52 })
      day.run(8 * HOUR)
      expect(day.relay()?.state ?? false).toBe(false)
    })

    test('a half tank: heats at night price', () => {
      const boiler = startAt(at(MONDAY, '03:00'))
      boiler.temperatures({ top: 50, bottom: 30 })
      expect(boiler.statusNow().plan.shortfallBaths).toBeGreaterThan(1)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_night' })
      // The top reaches the night limit: stop
      boiler.temperatures({ top: 55, bottom: 54 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'plan_night_reached' })
    })

    test('the night stops when nothing is missing, even under the night limit', () => {
      const boiler = startAt(at(SATURDAY, '03:00'))
      boiler.temperatures({ top: 50, bottom: 30 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_night' })
      boiler.temperatures({ top: 50, bottom: 50 })
      expect(boiler.statusNow().plan.shortfallBaths).toBe(0)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'plan_night_met' })
    })

    test('a half tank in the day: starts late enough to finish by 19:30', () => {
      const boiler = startAt(at(MONDAY, '12:00'))
      boiler.temperatures({ top: 50, bottom: 30 })
      const plan = boiler.statusNow().plan
      expect(plan.shortfallBaths).toBeGreaterThan(1)
      expect(plan.heatMinutes).toBeGreaterThan(30)
      // Start = 19:30 - the model's minutes - the 15 min margin
      const start = new Date(at(MONDAY, '19:30')).getTime() - (plan.heatMinutes + PLAN.startMarginMinutes) * MIN
      expect(plan.nextStart).toBe(start)
      expect(start).toBeGreaterThan(Date.now())
      // Not before the start
      boiler.run(start - Date.now() - MIN)
      expect(boiler.relay()?.state ?? false).toBe(false)
      boiler.run(MIN)
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_day' })
      // The window stays open while it heats, also when the model moves the start
      boiler.temperatures({ top: 50, bottom: 38 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_day' })
    })

    test('an empty tank in the day: an earlier start than a half tank', () => {
      const half = startAt(at(MONDAY, '12:00'))
      half.temperatures({ top: 50, bottom: 40 })
      const halfStart = half.statusNow().plan.nextStart
      jest.clearAllTimers()

      const empty = startAt(at(MONDAY, '12:00'))
      // Over emergencyMin (30 °C), so only the plan acts
      empty.temperatures({ top: 48, bottom: 31 })
      const plan = empty.statusNow().plan
      expect(plan.nextStart).toBeLessThan(halfStart)
      expect(empty.relay()?.state ?? false).toBe(false)
      empty.run(plan.nextStart - Date.now())
      expect(empty.relay()).toMatchObject({ state: true, reason: 'plan_day' })
    })

    test('more than the tank holds: the rest is heated during the baths', () => {
      const boiler = startAt(at(MONDAY, '12:00'))
      boiler.override(6)
      boiler.temperatures({ top: 55, bottom: 52 })
      const plan = boiler.statusNow().plan
      expect(plan.targetBaths).toBe(7)
      expect(plan.shortfallBaths).toBeGreaterThan(2)
      // Little more fits before the evening: the window opens just before 19:30
      expect(plan.nextStart).toBeLessThanOrEqual(new Date(at(MONDAY, '19:30')).getTime())
      expect(plan.nextStart).toBeGreaterThanOrEqual(new Date(at(MONDAY, '19:00')).getTime())
      boiler.run(7 * HOUR + 30 * MIN - MIN)
      expect(boiler.relay()?.state ?? false).toBe(false)
      // 19:35: a bath cools the top under the limit (too slowly for the draw
      // rule); the plan starts the element
      boiler.run(5 * MIN, () => ({ top: 51, bottom: 51 }))
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_day' })
    })

    test('the night hold still holds the plan, and a draw in it still starts the element (#1976)', () => {
      const boiler = startAt(at(MONDAY, '21:20'))
      boiler.temperatures({ top: 48, bottom: 45 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'night_tariff_hold' })
      // The plan's next start is the end of the hold, 22:15
      expect(boiler.statusNow().plan.nextStart).toBe(new Date(at(MONDAY, '22:15')).getTime())
      // A draw: the bottom falls 3 K within 10 min
      boiler.temperatures({ top: 48, bottom: 41 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'draw_heating' })
    })
  })

  describe('"Бани довечера" overrides the need for one evening', () => {
    test('the value replaces the need, is retained for Home Assistant and clears itself at midnight', () => {
      const boiler = startAt(at(MONDAY, '12:00'), { persisted: { eveningBaths: mondays([3, 3, 3, 3]) } })
      boiler.temperatures({ top: 55, bottom: 40 })
      boiler.override('5')
      expect(boiler.overrideStatus()).toMatchObject({ payload: { value: 5, date: MONDAY }, options: { retain: true } })
      expect(boiler.status().plan).toMatchObject({ need: 5, needSource: 'override', override: 5, targetBaths: 6 })
      expect(boiler.persistedCache.eveningOverride).toEqual({ date: MONDAY, baths: 5 })

      // Midnight: it clears, and the next evening uses its own need again
      boiler.run(12 * HOUR + 2 * MIN)
      expect(boiler.persistedCache.eveningOverride).toBeNull()
      expect(boiler.overrideStatus()).toMatchObject({ payload: { value: null }, options: { retain: true } })
      expect(boiler.statusNow().plan).toMatchObject({ date: '2026-11-24', needSource: 'season', override: null })
    })

    test('a value kept over a restart: still in force the same day, cleared on a later day', () => {
      const same = startAt(at(MONDAY, '15:00'), { persisted: { eveningOverride: { date: MONDAY, baths: 4 } } })
      same.temperatures({ top: 55, bottom: 40 })
      expect(same.overrideStatus().payload).toEqual({ value: 4, date: MONDAY })
      expect(same.statusNow().plan).toMatchObject({ need: 4, needSource: 'override' })
      jest.clearAllTimers()

      const later = startAt(at('2026-11-24', '09:00'), { persisted: { eveningOverride: { date: MONDAY, baths: 4 } } })
      expect(later.persistedCache.eveningOverride).toBeNull()
      expect(later.overrideStatus().payload).toEqual({ value: null, date: null })
    })

    test('the Home Assistant number writes and reads the topics of the plan', () => {
      const discovery = require(path.resolve(__dirname, '../../../config/automations/ha_discovery.js')).bots
      const number = discovery.boilerEveningBathsHaDiscovery.input.params.payload
      expect(number).toMatchObject({
        name: 'Бани довечера',
        command_topic: PLAN.overrideSetTopic,
        state_topic: PLAN.overrideStatusTopic,
        min: 0,
        max: PLAN.overrideMaxBaths
      })
      expect(number.device.identifiers).toBe('boiler_eldom_200l')
      // What Home Assistant sends for 3.5
      const boiler = startAt(at(MONDAY, '12:00'))
      boiler.temperatures({ top: 55, bottom: 40 })
      boiler.override(JSON.parse(number.command_template.replace('{{ value }}', '3.5')))
      expect(boiler.status().plan).toMatchObject({ need: 3.5, needSource: 'override' })
    })

    test('a bad value is refused and the need stays', () => {
      const boiler = startAt(at(MONDAY, '12:00'))
      boiler.temperatures({ top: 55, bottom: 40 })
      boiler.override('many')
      boiler.override(-1)
      boiler.override({ value: 99 })
      expect(boiler.persistedCache.eveningOverride ?? null).toBeNull()
      expect(boiler.statusNow().plan).toMatchObject({ need: 2.4, needSource: 'season' })
      boiler.override({ value: 0 }) // nobody at home tonight
      expect(boiler.status().plan).toMatchObject({ need: 0, needSource: 'override' })
    })
  })

  describe('every plan start is still blocked by the safety gates', () => {
    // In the day window with a big shortfall: the plan wants to heat
    const inWindow = (config = CONFIG) => {
      const boiler = startAt(at(MONDAY, '19:20'), { config })
      boiler.override(6)
      return boiler
    }

    test('the plan heats here when nothing blocks it', () => {
      const boiler = inWindow()
      boiler.temperatures({ top: 50, bottom: 30 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_day' })
    })

    test('maxSafe', () => {
      const boiler = inWindow({ ...CONFIG, maxSafe: 52, hotWaterLimit: 60 })
      boiler.temperatures({ top: 52, bottom: 30 })
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'safety_shutoff_overheated' })
    })

    test('the top limit: a plan limit above hotWaterLimit is capped', () => {
      const config = { ...CONFIG, eveningPlan: { ...PLAN, dayLimit: 70, nightLimit: 70 } }
      const day = inWindow(config)
      day.temperatures({ top: 55, bottom: 30 })
      expect(day.relay()).toMatchObject({ state: false, reason: 'plan_day_reached' })
      jest.clearAllTimers()
      const night = startAt(at(MONDAY, '03:00'), { config })
      night.temperatures({ top: 55, bottom: 30 })
      expect(night.relay()).toMatchObject({ state: false, reason: 'plan_night_reached' })
    })

    test('old readings', () => {
      const boiler = inWindow()
      boiler.temperatures({ top: 50, bottom: 30 })
      expect(boiler.relay()).toMatchObject({ state: true, reason: 'plan_day' })
      // No reading for over 10 min: the element stops, the plan has no number
      jest.advanceTimersByTime(11 * MIN)
      expect(boiler.relay()).toMatchObject({ state: false, reason: 'input_stale' })
      expect(boiler.status().plan.need).toBeNull()
    })

    test('the dishwasher and the main power', () => {
      const dish = inWindow()
      dish.dishwasher(1500)
      dish.temperatures({ top: 50, bottom: 30 })
      expect(dish.relay()).toMatchObject({ state: false, reason: 'load_wait_dishwasher' })
      jest.clearAllTimers()

      const main = inWindow()
      main.mainPower(7000)
      main.temperatures({ top: 50, bottom: 30 })
      expect(main.relay()).toMatchObject({ state: false, reason: 'load_wait_main_power' })
    })
  })
})
