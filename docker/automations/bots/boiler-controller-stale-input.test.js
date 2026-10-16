const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live limits.
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

const MIN = 60 * 1000
// Midday in winter: outside the night tariff hold.
const MIDDAY = '2026-11-02T12:00:00+02:00'
// Top under comfortMin, so fresh data starts the element.
const COOL = { top: 45, bottom: 35 }

const startAt = (localIso) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  const httpPost = jest.fn().mockResolvedValue({ ok: true })
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload) => { published.push({ topic, payload }) }
  }
  require('./boiler-controller')('boilerController', { ...CONFIG, httpPost }).start({
    mqtt,
    persistedCache: { controlMode: 'automatic', manualOverrideExpires: null }
  })
  const deliver = (topic, payload) => subscriptions.get(topic)(payload)
  return {
    temperatures: ({ top, bottom }) => {
      deliver(CONFIG.temperatureBottomTopic, { state: bottom })
      deliver(CONFIG.temperatureTopTopic, { state: top })
    },
    temperaturesMadeAt: (madeAt, { top, bottom }) => {
      deliver(CONFIG.temperatureBottomTopic, { state: bottom, _tz: madeAt })
      deliver(CONFIG.temperatureTopTopic, { state: top, _tz: madeAt })
    },
    controlMode: (mode) => deliver(CONFIG.controlModeTopic, mode),
    relay: () => published.filter(m => m.topic === CONFIG.boilerRelayTopic).at(-1).payload,
    relayReasons: () => published.filter(m => m.topic === CONFIG.boilerRelayTopic).map(m => m.payload.reason),
    alerts: () => httpPost.mock.calls.map(([, body]) => body.message)
  }
}

describe('boiler-controller with old boiler temperatures (#1743)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('heats on fresh data', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperatures(COOL)

    expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
  })

  test('does not report stale in the first 10 min after a start', () => {
    const boiler = startAt(MIDDAY)
    jest.advanceTimersByTime(10 * MIN)

    expect(boiler.relayReasons()).not.toContain('input_stale')
    expect(boiler.alerts()).toEqual([])
  })

  test('turns the element off when the temperatures are older than 10 min', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperatures(COOL)

    jest.advanceTimersByTime(10 * MIN)
    expect(boiler.relay()).toMatchObject({ state: true })

    jest.advanceTimersByTime(1 * MIN)
    expect(boiler.relay()).toMatchObject({ state: false, reason: 'input_stale' })
  })

  test('sends one alert for the whole outage', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperatures(COOL)

    jest.advanceTimersByTime(4 * 60 * MIN)

    expect(boiler.alerts()).toHaveLength(1)
    expect(boiler.alerts()[0]).toContain('no boiler temperature for 10 min')
    expect(boiler.relayReasons().filter(r => r === 'input_stale')).toHaveLength(1)
  })

  test('returns to normal control and sends "resolved" when the data returns', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperatures(COOL)
    jest.advanceTimersByTime(30 * MIN)

    boiler.temperatures(COOL)

    expect(boiler.relay()).toMatchObject({ state: true, reason: 'comfort_heating_insufficient' })
    expect(boiler.alerts()).toHaveLength(2)
    expect(boiler.alerts()[1]).toContain('boiler temperature is back')
  })

  // Feature status topics are retained, so a start can get values from long ago.
  test('treats old retained temperatures after a start as old', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperaturesMadeAt(Date.now() - 2 * 60 * MIN, COOL)

    expect(boiler.relay()).toMatchObject({ state: false, reason: 'input_stale' })
    expect(boiler.alerts()).toHaveLength(1)
  })

  test('lets a manual mode expire on time during an outage', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperatures(COOL)
    boiler.controlMode({ mode: 'manual_on', duration: 20 * MIN })
    expect(boiler.relay()).toMatchObject({ state: true })

    jest.advanceTimersByTime(31 * MIN)

    expect(boiler.relay()).toMatchObject({ state: false, reason: 'input_stale' })
  })

  test('manual mode still overrides old data', () => {
    const boiler = startAt(MIDDAY)
    boiler.temperatures(COOL)
    jest.advanceTimersByTime(30 * MIN)

    boiler.controlMode('manual_on')

    expect(boiler.relay()).toMatchObject({ state: true })
    expect(boiler.relay().reason).toMatch(/^manual_on/)
  })
})
