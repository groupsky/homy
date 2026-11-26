const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live values.
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/boiler-controller-config.js'))
  .bots.boilerController

const MIN = 60 * 1000
// The first full status goes out this long after the start
const STARTUP = 10 * 1000
// Midday in winter: outside the night tariff hold. Cold water in November: 14.6 °C.
const MIDDAY = '2026-11-02T12:00:00+02:00'

const startAt = (localIso) => {
  jest.useFakeTimers({ now: new Date(localIso) })
  const subscriptions = new Map()
  const published = []
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload) => {
      published.push({ topic, payload })
      // The relay reader reports each command back as the contactor state.
      if (topic === CONFIG.boilerRelayTopic) {
        const echoTo = subscriptions.get(CONFIG.contactorStatusTopic)
        if (typeof echoTo === 'function') echoTo({ state: payload.state })
      }
    }
  }
  require('./boiler-controller')('boilerController', {
    ...CONFIG,
    verbose: false,
    httpPost: jest.fn().mockResolvedValue({ ok: true })
  }).start({
    mqtt,
    persistedCache: { controlMode: 'automatic', manualOverrideExpires: null }
  })
  subscriptions.get(CONFIG.contactorStatusTopic)({ state: false })
  const deliver = (topic, payload) => subscriptions.get(topic)(payload)
  return {
    temperatures: ({ top, bottom }) => {
      deliver(CONFIG.temperatureBottomTopic, { state: bottom })
      deliver(CONFIG.temperatureTopTopic, { state: top })
    },
    controlMode: (mode) => deliver(CONFIG.controlModeTopic, mode),
    status: () => published.filter(m => m.topic === CONFIG.automationStatusTopic).at(-1).payload,
    relayCount: () => published.filter(m => m.topic === CONFIG.boilerRelayTopic).length
  }
}

describe('boiler-controller baths ready (#1984)', () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('element off, boost would start it: minutes with boost only', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 55, bottom: 40 })
    jest.advanceTimersByTime(STARTUP) // the startup status
    const s = c.status()
    expect(s.heaterState).toBe(false)
    expect(s.bathsReady).toBeGreaterThan(1.5)
    expect(s.bathsReady).toBeLessThan(2.5)
    expect(Number.isInteger(s.usableLitres)).toBe(true)
    expect(s.minutesToNextBath).toBeNull()
    expect(s.boostMinutesToNextBath).toBeGreaterThan(60)
    expect(s.bathInputs).toEqual({ top: 55, bottom: 40, cold: 14.6 })
    expect(s.bathText).toBe(`Готови: ${String(s.bathsReady).replace('.', ',')} бани. ` +
      `С „Загрей целия бойлер“ още една след ~${s.boostMinutesToNextBath} мин.`)
  })

  test('the boost name in the sentence is the name of the Home Assistant button', () => {
    const discovery = require(path.resolve(__dirname, '../../../config/automations/ha_discovery.js')).bots
    expect(discovery.boilerBoostHaDiscovery.input.params.payload.name).toBe(CONFIG.boostButtonName)
  })

  test('element runs: minutes to one more bath, no boost minutes', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 45, bottom: 30 }) // under comfortMin: the element starts
    const s = c.status()
    expect(s.heaterState).toBe(true)
    // A cold bottom: the element runs at full power, so the next bath comes soon
    expect(s.minutesToNextBath).toBeGreaterThanOrEqual(40)
    expect(s.minutesToNextBath).toBeLessThanOrEqual(95)
    expect(s.boostMinutesToNextBath).toBeNull()
    expect(s.bathText).toBe(`Готови: ${String(s.bathsReady).replace('.', ',')} бани. Още една след ~${s.minutesToNextBath} мин.`)
  })

  test('element off, boost refused at the top limit: baths only', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 60, bottom: 45 })
    c.controlMode('boost') // refused: the top is at boostTopLimit
    jest.advanceTimersByTime(STARTUP)
    const s = c.status()
    expect(s.heaterState).toBe(false)
    expect(s.minutesToNextBath).toBeNull()
    expect(s.boostMinutesToNextBath).toBeNull()
    expect(s.bathText).toBe(`Готови: ${String(s.bathsReady).replace('.', ',')} бани.`)
  })

  test('element off, boost refused with the bottom at its target: baths only', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 55, bottom: 50 })
    jest.advanceTimersByTime(STARTUP)
    const s = c.status()
    expect(s.boostMinutesToNextBath).toBeNull()
    expect(s.bathText).toMatch(/^Готови: [\d,]+ бани\.$/)
  })

  const NONE = {
    bathsReady: null,
    usableLitres: null,
    minutesToNextBath: null,
    boostMinutesToNextBath: null,
    bathText: null,
    bathInputs: null
  }

  test('missing readings: no number', () => {
    const c = startAt(MIDDAY)
    jest.advanceTimersByTime(15 * MIN)
    expect(c.status()).toMatchObject(NONE)
  })

  test('only the top reading: no number', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 55, bottom: undefined })
    jest.advanceTimersByTime(STARTUP)
    expect(c.status()).toMatchObject(NONE)
  })

  test('old readings: no number, never the old one', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 55, bottom: 40 })
    jest.advanceTimersByTime(STARTUP)
    expect(c.status().bathsReady).not.toBeNull()
    // No reading for longer than maxInputAgeMs (10 min), before the next
    // heartbeat: the status that marks the readings old carries no number
    jest.advanceTimersByTime(11 * MIN)
    const s = c.status()
    expect(s.reason).toBe('input_stale')
    expect(s).toMatchObject(NONE)
  })

  test('the bath numbers never send a relay command', () => {
    const c = startAt(MIDDAY)
    c.temperatures({ top: 55, bottom: 40 })
    const before = c.relayCount()
    // An hour of fresh readings and heartbeats, the bath numbers in each status
    for (let i = 0; i < 12; i++) {
      jest.advanceTimersByTime(5 * MIN)
      c.temperatures({ top: 55, bottom: 40 })
    }
    expect(c.status().bathsReady).not.toBeNull()
    expect(c.relayCount()).toBe(before)
  })
})

describe('Home Assistant baths ready sensor (#1984)', () => {
  test('on the boiler device, the sentence from the status, unknown without it', () => {
    const discovery = require(path.resolve(__dirname, '../../../config/automations/ha_discovery.js')).bots
    const bot = discovery.boilerBathsReadyHaDiscovery
    expect(bot).toBeDefined()
    const payload = bot.input.params.payload
    expect(payload).toMatchObject({
      state_topic: CONFIG.automationStatusTopic,
      json_attributes_topic: CONFIG.automationStatusTopic,
      device: { identifiers: 'boiler_eldom_200l' },
      unique_id: 'homy_boiler_baths_ready',
      default_entity_id: 'sensor.boiler_baths_ready'
    })
    // "None" is how a Home Assistant MQTT sensor template says unknown
    expect(payload.value_template).toBe('{{ value_json.bathText if value_json.bathText else None }}')
    for (const field of ['bathsReady', 'usableLitres', 'minutesToNextBath', 'boostMinutesToNextBath', 'bathInputs']) {
      expect(payload.json_attributes_template).toContain(field)
    }
  })
})
