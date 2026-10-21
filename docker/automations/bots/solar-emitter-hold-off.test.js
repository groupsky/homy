const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const SunCalc = require('suncalc')
const solarEmitter = require('./solar-emitter')

const HOLD_STATUS = 'homy/features/switch/dark_sky_tonight/status'
const HOLD_SET = 'homy/features/switch/dark_sky_tonight/set'
const HOUR = 60 * 60 * 1000

// Fixed sun times, so the tests do not depend on the real sun: sunrise at
// 05:00 and sunset at 19:00 UTC on every day.
const fakeTimes = (date) => {
  const day = date.toISOString().slice(0, 10)
  return {
    sunrise: new Date(`${day}T05:00:00Z`),
    sunset: new Date(`${day}T19:00:00Z`)
  }
}

const bots = {
  z2m: {
    statusTopic: 'light/status',
    commandTopic: 'light/set',
    stateParser: (payload) => payload.state === 'ON',
    commandTemplate: (state) => ({ state: state ? 'ON' : 'OFF' }),
    lightOn: { state: 'ON' },
    lightOff: { state: 'OFF' }
  },
  relay: {
    statusTopic: 'relays/reading',
    commandTopic: 'relays/write',
    stateParser: ({ outputs }) => Boolean(outputs & (1 << 15)),
    commandTemplate: (state) => ({ out15: state }),
    lightOn: { outputs: 0x8000 },
    lightOff: { outputs: 0 }
  }
}

describe.each(Object.keys(bots))('solar-emitter hold-off (%s)', (kind) => {
  const { lightOn, lightOff, ...device } = bots[kind]
  const config = {
    ...device,
    lat: 45.0,
    lon: 10.0,
    solarTimeStates: { sunset: true, sunrise: false },
    holdOffStatusTopic: HOLD_STATUS,
    holdOffSetTopic: HOLD_SET,
    verbose: false
  }

  let mqtt
  let subscriptions
  let persistedCache
  let getTimes

  const start = (overrides = {}) => {
    subscriptions = {}
    mqtt = { publish: jest.fn(), subscribe: (topic, cb) => { subscriptions[topic] = cb } }
    solarEmitter('nightLights', { ...config, ...overrides }).start({ mqtt, persistedCache })
  }
  const setLight = (on) => subscriptions[config.statusTopic](on ? lightOn : lightOff)
  const holdOff = (payload) => subscriptions[HOLD_STATUS](payload)
  // The bot repeats a command while the light has not reported the change, so
  // a run of the same command counts as one.
  const commands = () => mqtt.publish.mock.calls
    .filter(([topic]) => topic === config.commandTopic)
    .map(([, p]) => p)
    .filter((p, i, all) => i === 0 || JSON.stringify(p) !== JSON.stringify(all[i - 1]))
  const holdOffSets = () => mqtt.publish.mock.calls.filter(([topic]) => topic === HOLD_SET).map(([, p]) => p)
  const at = (iso) => jest.setSystemTime(new Date(iso))
  const advanceTo = (iso) => jest.advanceTimersByTime(new Date(iso).getTime() - Date.now())
  const on = (iso) => ({ state: true, _tz: new Date(iso).getTime() })

  beforeEach(() => {
    jest.useFakeTimers()
    getTimes = jest.spyOn(SunCalc, 'getTimes').mockImplementation((date) => fakeTimes(date))
    persistedCache = { holdOffSince: null }
    at('2024-06-15T12:00:00Z')
  })

  afterEach(() => {
    getTimes.mockRestore()
    jest.useRealTimers()
  })

  it('keeps the lights off from sunset until sunrise when the switch is on', () => {
    start()
    holdOff(on('2024-06-15T12:00:00Z'))
    setLight(false)
    advanceTo('2024-06-15T19:00:01Z')
    expect(commands()).toEqual([])
    advanceTo('2024-06-16T03:00:00Z')
    expect(commands()).toEqual([])
  })

  it('follows sunset and sunrise as today when the switch is off', () => {
    start()
    holdOff({ state: false })
    setLight(false)
    advanceTo('2024-06-15T19:00:01Z')
    expect(commands()).toEqual([config.commandTemplate(true)])
    setLight(true)
    advanceTo('2024-06-16T05:00:01Z')
    expect(commands()).toEqual([config.commandTemplate(true), config.commandTemplate(false)])
  })

  it('turns the switch off at sunrise, and the next evening the lights come on', () => {
    start()
    holdOff(on('2024-06-15T12:00:00Z'))
    setLight(false)
    advanceTo('2024-06-16T05:00:01Z')
    expect(holdOffSets()).toEqual([{ state: false }])

    holdOff({ state: false, _tz: Date.now() })
    advanceTo('2024-06-16T19:00:01Z')
    expect(commands()).toEqual([config.commandTemplate(true)])
  })

  it('does not turn the switch off when it is pressed in the daytime', () => {
    start()
    holdOff(on('2024-06-15T12:00:00Z'))
    setLight(false)
    expect(holdOffSets()).toEqual([])
  })

  it('turns the lights off at once when the switch is pressed while they are on', () => {
    at('2024-06-15T22:00:00Z')
    start()
    setLight(true)
    holdOff({ state: false })
    expect(commands()).toEqual([])

    holdOff(on('2024-06-15T22:00:00Z'))
    expect(commands()).toEqual([config.commandTemplate(false)])
    expect(holdOffSets()).toEqual([])
  })

  it('turns the lights on at once when the switch is turned off at night', () => {
    at('2024-06-15T22:00:00Z')
    start()
    holdOff(on('2024-06-15T21:00:00Z'))
    setLight(false)
    expect(commands()).toEqual([])

    holdOff({ state: false })
    expect(commands()).toEqual([config.commandTemplate(true)])
  })

  it.each([
    ['no message', undefined],
    ['an empty payload', {}],
    ['a text state', { state: 'maybe' }],
    ['a null state', { state: null }],
    ['not an object', 'on']
  ])('follows the sun as today with %s', (_label, payload) => {
    at('2024-06-15T22:00:00Z')
    start()
    if (payload !== undefined) holdOff(payload)
    setLight(false)
    expect(commands()).toEqual([config.commandTemplate(true)])
    expect(holdOffSets()).toEqual([])
  })

  it('ignores an on-state from before the last sunrise and turns the switch off', () => {
    at('2024-06-15T22:00:00Z')
    start()
    setLight(false)
    holdOff(on('2024-06-14T22:00:00Z'))
    expect(commands()).toEqual([config.commandTemplate(true)])
    expect(holdOffSets()).toEqual([{ state: false }])
  })

  it('does not send the switch-off again and again', () => {
    at('2024-06-15T22:00:00Z')
    start()
    holdOff(on('2024-06-14T22:00:00Z'))
    setLight(false)
    setLight(false)
    expect(holdOffSets()).toHaveLength(1)
  })

  describe('when the status has no time', () => {
    it('remembers when it first saw the switch turn on', () => {
      at('2024-06-15T21:00:00Z')
      start()
      holdOff({ state: true })
      expect(persistedCache.holdOffSince).toBe(Date.now())
      setLight(true)
      expect(commands()).toEqual([config.commandTemplate(false)])
    })

    it('uses the remembered time after a restart', () => {
      persistedCache.holdOffSince = new Date('2024-06-15T21:00:00Z').getTime()
      at('2024-06-15T23:00:00Z')
      start()
      holdOff({ state: true })
      setLight(true)
      expect(commands()).toEqual([config.commandTemplate(false)])
    })

    it('treats a remembered time from before the last sunrise as expired', () => {
      persistedCache.holdOffSince = new Date('2024-06-14T21:00:00Z').getTime()
      at('2024-06-15T23:00:00Z')
      start()
      holdOff({ state: true })
      setLight(false)
      expect(commands()).toEqual([config.commandTemplate(true)])
      expect(holdOffSets()).toEqual([{ state: false }])
    })

    it('forgets the time when the switch goes off', () => {
      start()
      holdOff({ state: true })
      holdOff({ state: false })
      expect(persistedCache.holdOffSince).toBeNull()
    })
  })

  describe('log lines', () => {
    let log
    beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}) })
    afterEach(() => { log.mockRestore() })
    const lines = () => log.mock.calls.map(([line]) => line)

    it('logs one night once each', () => {
      start()
      holdOff(on('2024-06-15T12:00:00Z'))
      setLight(false)
      holdOff(on('2024-06-15T12:00:00Z'))
      expect(lines()).toEqual([
        '[nightLights] wanted: off',
        '[nightLights] hold-off switch on (since 2024-06-15T12:00:00.000Z)'
      ])

      advanceTo('2024-06-15T19:00:01Z')
      setLight(false)
      expect(lines().slice(2)).toEqual(['[nightLights] wanted: off (hold-off)'])

      advanceTo('2024-06-16T05:00:01Z')
      expect(lines().slice(3)).toEqual([
        '[nightLights] sunrise: turning the hold-off switch off',
        '[nightLights] wanted: off'
      ])
      holdOff({ state: false, _tz: Date.now() })
      holdOff({ state: false, _tz: Date.now() })
      expect(lines().slice(5)).toEqual(['[nightLights] hold-off switch off'])

      advanceTo('2024-06-16T19:00:01Z')
      expect(lines().slice(6)).toEqual(['[nightLights] wanted: on'])
      expect(lines()).toHaveLength(7)
    })

    it('logs the expired on-state, and no off line for a first off status', () => {
      at('2024-06-15T22:00:00Z')
      start()
      holdOff({ state: false })
      expect(lines()).toEqual(['[nightLights] wanted: on'])
      log.mockClear()
      holdOff(on('2024-06-14T22:00:00Z'))
      expect(lines()).toContain('[nightLights] hold-off switch is from before the last sunrise: turning it off')
    })

    it('asks and logs once while an expired on-state keeps being reported', () => {
      start()
      holdOff(on('2024-06-15T12:00:00Z'))
      setLight(false)
      advanceTo('2024-06-16T05:00:01Z')
      holdOff(on('2024-06-15T12:00:00Z'))
      holdOff(on('2024-06-15T12:00:00Z'))
      const expired = lines().filter((l) => l.includes('turning'))
      expect(expired).toEqual(['[nightLights] sunrise: turning the hold-off switch off'])
      expect(holdOffSets()).toHaveLength(1)
    })

    it('uses the first-seen time when the status time is not a number', () => {
      at('2024-06-15T21:00:00Z')
      start()
      holdOff({ state: true, _tz: 'x' })
      expect(persistedCache.holdOffSince).toBe(Date.now())
      expect(lines()).toContain('[nightLights] hold-off switch on (since 2024-06-15T21:00:00.000Z)')
    })

    it('logs nothing new without the hold-off topics', () => {
      start({ holdOffStatusTopic: undefined, holdOffSetTopic: undefined })
      setLight(false)
      advanceTo('2024-06-16T05:00:01Z')
      expect(lines()).toEqual([])
    })
  })

  it('behaves as before without the hold-off topics', () => {
    start({ holdOffStatusTopic: undefined, holdOffSetTopic: undefined })
    expect(subscriptions[HOLD_STATUS]).toBeUndefined()
    setLight(false)
    advanceTo('2024-06-15T19:00:01Z')
    expect(commands()).toEqual([config.commandTemplate(true)])
  })

  it('asks for a persisted cache only when the hold-off is configured', () => {
    expect(solarEmitter('a', config).persistedCache).toEqual({ version: 1, default: { holdOffSince: null } })
    expect(solarEmitter('a', { ...config, holdOffStatusTopic: undefined, holdOffSetTopic: undefined }).persistedCache).toBeUndefined()
  })
})
