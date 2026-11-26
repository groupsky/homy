const { describe, test, expect } = require('@jest/globals')
const path = require('path')
const tank = require('./boiler-tank')

const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

const estimate = (top, bottom, extra = {}) => tank.bathEstimate({
  top,
  bottom,
  cold: 13,
  heating: true,
  boostAllowed: false,
  bathLitres: CONFIG.bathLitres,
  bathTempC: CONFIG.bathTempC,
  elementPowerByTempKw: CONFIG.elementPowerByTempKw,
  tank: CONFIG.tankModel,
  ...extra
})

describe('boiler tank model (#1984)', () => {
  // The table of the issue, cold water 13 °C: [top, bottom, litres, baths, minutes]
  test.each([
    [65, 10, 104, 1.6, 85],
    [55, 25, 90, 1.4, 75],
    [55, 45, 172, 2.6, 125],
    [55, 55, 229, 3.5, 160],
    [60, 60, 262, 4.0, 160]
  ])('top %d °C, bottom %d °C: %d L, %d baths, one more in ~%d min', (top, bottom, litres, baths, minutes) => {
    const e = estimate(top, bottom)
    expect(Math.abs(e.bathsReady - baths)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(e.usableLitres - litres)).toBeLessThanOrEqual(6.5)
    expect(Math.abs(e.minutesToNextBath - minutes)).toBeLessThanOrEqual(10)
  })

  test('one more bath takes about 60-95 min with a cold bottom and 2-2.5 h with a warm one', () => {
    expect(estimate(55, 25).minutesToNextBath).toBeGreaterThanOrEqual(60)
    expect(estimate(55, 25).minutesToNextBath).toBeLessThanOrEqual(95)
    expect(estimate(55, 45).minutesToNextBath).toBeGreaterThanOrEqual(120)
    expect(estimate(55, 45).minutesToNextBath).toBeLessThanOrEqual(150)
  })

  test('the committed tank geometry is the default one', () => {
    expect(CONFIG.tankModel).toEqual(tank.DEFAULT_TANK)
  })

  test('boost minutes only while the element is off and a boost would start it', () => {
    const off = estimate(55, 25, { heating: false, boostAllowed: true })
    expect(off.minutesToNextBath).toBeNull()
    // Boost only starts the element now: the same number as heating
    expect(off.boostMinutesToNextBath).toBe(estimate(55, 25).minutesToNextBath)

    expect(estimate(55, 25, { heating: true, boostAllowed: true }).boostMinutesToNextBath).toBeNull()
    const refused = estimate(60, 45, { heating: false, boostAllowed: false })
    expect(refused.minutesToNextBath).toBeNull()
    expect(refused.boostMinutesToNextBath).toBeNull()
    expect(refused.bathsReady).toBeGreaterThan(0)
  })

  test.each([
    [null, 40], [55, null], [undefined, 40], [NaN, 40], [55, 'x']
  ])('no number with top %p and bottom %p', (top, bottom) => {
    expect(estimate(top, bottom, { boostAllowed: true })).toEqual({
      bathsReady: null, usableLitres: null, minutesToNextBath: null, boostMinutesToNextBath: null
    })
  })

  test('a tank colder than a bath holds no bath', () => {
    expect(estimate(35, 20).bathsReady).toBe(0)
  })

  test('the element power by the water temperature at the element', () => {
    const table = CONFIG.elementPowerByTempKw
    expect(tank.elementPowerKw(table, 20)).toBe(2.6)
    expect(tank.elementPowerKw(table, 30)).toBe(2.1)
    expect(tank.elementPowerKw(table, 44.9)).toBe(1.05)
    expect(tank.elementPowerKw(table, 70)).toBe(0.75)
  })

  test('the cold water of the month on the local clock', () => {
    const months = CONFIG.coldWaterByMonth
    expect(months).toHaveLength(12)
    // 23:30 UTC on 31 July is already 1 August in Sofia
    expect(tank.coldWaterAt(months, Date.parse('2026-07-31T23:30:00Z'), 'Europe/Sofia')).toBe(23.9)
    expect(tank.coldWaterAt(months, Date.parse('2026-01-15T12:00:00Z'), 'Europe/Sofia')).toBe(11.6)
  })

  test('one bath is about 2.0 kWh in winter and 1.3 kWh in summer', () => {
    expect(tank.bathKwh(65, 40, 13)).toBeCloseTo(2.0, 1)
    expect(tank.bathKwh(65, 40, 23)).toBeCloseTo(1.3, 1)
  })
})

describe('the Bulgarian sentence (#1984)', () => {
  const BUTTON = 'Загрей целия бойлер'
  test('element off, boost would start it', () => {
    expect(tank.bathSentence({ bathsReady: 2, minutesToNextBath: null, boostMinutesToNextBath: 35 }, BUTTON))
      .toBe('Готови: 2 бани. С „Загрей целия бойлер“ още една след ~35 мин.')
  })
  test('element runs', () => {
    expect(tank.bathSentence({ bathsReady: 1.5, minutesToNextBath: 40, boostMinutesToNextBath: null }, BUTTON))
      .toBe('Готови: 1,5 бани. Още една след ~40 мин.')
  })
  test('element off, boost would be refused', () => {
    expect(tank.bathSentence({ bathsReady: 3.5, minutesToNextBath: null, boostMinutesToNextBath: null }, BUTTON))
      .toBe('Готови: 3,5 бани.')
  })
  test('one bath is singular', () => {
    expect(tank.bathSentence({ bathsReady: 1, minutesToNextBath: null, boostMinutesToNextBath: null }, BUTTON))
      .toBe('Готови: 1 баня.')
  })
  test('no number, no sentence', () => {
    expect(tank.bathSentence({ bathsReady: null, minutesToNextBath: null, boostMinutesToNextBath: null }, BUTTON))
      .toBeNull()
  })
})
