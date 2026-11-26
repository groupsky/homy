const { describe, test, expect } = require('@jest/globals')
const path = require('path')
const plan = require('./boiler-plan')
const tank = require('./boiler-tank')

const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

describe('boiler evening plan helpers (#1985)', () => {
  describe('energy balance of one evening', () => {
    test('a recorded evening: uniform 55 °C at 18:00, 30 °C at 24:00, 4 kWh from the element', () => {
      // By hand: the tank gives 184 L x 1.163 Wh/(L K) x 25 K = 5.350 kWh,
      // the element 4 kWh, the standby loss 40 W x 6 h = 0.24 kWh:
      // used 9.110 kWh. One bath at 15 °C cold water: 65 L x 1.163 x 25 K
      // = 1.890 kWh. So 4.82 baths.
      const baths = plan.eveningBaths({
        start: { top: 55, bottom: 55 },
        end: { top: 30, bottom: 30 },
        elementKwh: 4,
        hours: 6,
        standbyW: 40,
        cold: 15,
        bathLitres: 65,
        bathTempC: 40
      })
      expect(baths).toBeCloseTo(4.82, 2)
    })

    test('a recorded evening with layers: 55/45 °C at 18:00, 45/20 °C at 24:00, 7.9 kWh', () => {
      const cold = 14.6
      const start = { top: 55, bottom: 45 }
      const end = { top: 45, bottom: 20 }
      const baths = plan.eveningBaths({ start, end, elementKwh: 7.9, hours: 6, standbyW: 40, cold, bathLitres: 65, bathTempC: 40 })
      const stored = (t) => tank.gradualProfile(t.bottom, t.top, cold)
        .reduce((sum, layer) => sum + 11.5 * 1.163e-3 * (layer - cold), 0)
      const expected = (stored(start) - stored(end) + 7.9 - 0.24) / (65 * 1.163e-3 * (40 - cold))
      expect(baths).toBeCloseTo(expected, 6)
      // A big evening: about 6 baths
      expect(baths).toBeGreaterThan(5.5)
      expect(baths).toBeLessThan(6.5)
    })

    test('a missing reading gives no number', () => {
      expect(plan.eveningBaths({ start: { top: 55, bottom: null }, end: { top: 40, bottom: 20 }, elementKwh: 1, hours: 6, standbyW: 40, cold: 13, bathLitres: 65, bathTempC: 40 })).toBeNull()
    })
  })

  describe('the need of an evening', () => {
    const options = { count: 4, maxDays: 56, maxBaths: 15 }

    test('the mean of the last 4 same weekdays', () => {
      // 2026-11-23 is a Monday
      const history = {
        '2026-10-26': 1.0, // the fifth Monday back: not used
        '2026-11-02': 2.0,
        '2026-11-09': 3.0,
        '2026-11-16': 4.0,
        '2026-11-19': 9.0, // a Thursday: not used
        '2026-11-22': 9.0, // a Sunday: not used
        '2026-10-19': 5.0
      }
      // Only three Mondays from 11-02 on, so 10-26 is the fourth
      expect(plan.learnedNeed(history, '2026-11-23', options)).toBeCloseTo((1 + 2 + 3 + 4) / 4, 6)
      history['2026-11-23'] = 6.0 // the same evening itself is never used
      expect(plan.learnedNeed(history, '2026-11-23', options)).toBeCloseTo(2.5, 6)
      history['2026-10-05'] = 7.0
      expect(plan.learnedNeed({ ...history, '2026-11-30': 1 }, '2026-11-30', options)).toBeCloseTo((2 + 3 + 4 + 6) / 4, 6)
    })

    test('fewer than 4, old or broken values: no learned need', () => {
      expect(plan.learnedNeed({ '2026-11-02': 2, '2026-11-09': 3, '2026-11-16': 4 }, '2026-11-23', options)).toBeNull()
      // Older than 56 days does not count
      expect(plan.learnedNeed({ '2026-09-21': 2, '2026-11-02': 2, '2026-11-09': 3, '2026-11-16': 4 }, '2026-11-23', options)).toBeNull()
      expect(plan.learnedNeed({ '2026-10-26': 'x', '2026-11-02': -1, '2026-11-09': 99, '2026-11-16': 4, 'bad': 3 }, '2026-11-23', options)).toBeNull()
      expect(plan.learnedNeed(null, '2026-11-23', options)).toBeNull()
      expect(plan.learnedNeed('broken', '2026-11-23', options)).toBeNull()
    })

    test('the season table of the committed config', () => {
      const table = CONFIG.eveningPlan.bathsBySeason
      expect(plan.seasonNeed(table, 11, 0)).toBe(2.4) // winter Monday
      expect(plan.seasonNeed(table, 1, 6)).toBe(2.8) // winter Sunday
      expect(plan.seasonNeed(table, 4, 6)).toBe(3.5) // spring Sunday
      expect(plan.seasonNeed(table, 10, 4)).toBe(2.0) // autumn Friday
      expect(plan.seasonNeed(table, 7, 3)).toBe(1.9) // summer Thursday
      // Every month and weekday has a value
      for (let month = 1; month <= 12; month++) {
        for (let weekday = 0; weekday < 7; weekday++) expect(plan.seasonNeed(table, month, weekday)).not.toBeNull()
      }
      expect(plan.seasonNeed(undefined, 11, 0)).toBeNull()
    })
  })

  test('the wall clock: date, weekday and minutes in Sofia', () => {
    const at = plan.localClock('Europe/Sofia')
    expect(at(new Date('2026-11-23T19:30:00+02:00').getTime())).toEqual({ date: '2026-11-23', weekday: 0, month: 11, minutes: 19 * 60 + 30 })
    // 23:30 UTC is already the next day in Sofia
    expect(at(new Date('2026-11-29T23:30:00Z').getTime())).toMatchObject({ date: '2026-11-30', weekday: 0, minutes: 90 })
  })

  test('minutes to store: more litres take longer; the top limit ends it', () => {
    const cold = 14.6
    const profile = tank.gradualProfile(20, 45, cold)
    const now = tank.usableLitres(profile, cold, 40)
    const args = { profile, cold, bathTempC: 40, powerTable: CONFIG.elementPowerByTempKw, topLimit: 55 }
    const one = plan.minutesToStore({ ...args, litres: now + 65 })
    const two = plan.minutesToStore({ ...args, litres: now + 130 })
    expect(one).toBeGreaterThan(30)
    expect(two).toBeGreaterThan(one)
    expect(plan.minutesToStore({ ...args, litres: now })).toBe(0)
    // More than the tank can hold at 55 °C: it stops when the top reaches 55
    const full = plan.minutesToStore({ ...args, litres: 1000 })
    expect(full).toBeLessThan(600)
    expect(full).toBeGreaterThanOrEqual(two)
  })
})
