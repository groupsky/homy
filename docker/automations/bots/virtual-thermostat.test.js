const { describe, test, expect, jest, afterEach } = require('@jest/globals')
const path = require('path')

// The committed bot config, so these tests check the live limits.
const CONFIG = require(path.resolve(__dirname, '../../../config/automations/config.js'))
  .bots.livingRoomThermostat

const MIN = 60 * 1000
const HOUR = 60 * MIN
const START = '2026-11-02T12:00:00Z'
// Long enough for the room data to count as old
const ROOM_OLD = CONFIG.roomMaxAgeMs + 10 * MIN

const iso = (ms) => new Date(ms).toISOString()

// Starts the bot with fake timers. `cache` is the persisted state from an
// earlier run; without it the bot starts with its defaults. `oldState` is the
// state of an older version: it goes through migrate, as after a deploy.
const startBot = ({ cache, oldState, at = START, isEnabled = () => true } = {}) => {
  if (at) jest.useFakeTimers({ now: new Date(at) })
  const subscriptions = new Map()
  const published = []
  const httpPost = jest.fn().mockResolvedValue({ ok: true })
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  const mqtt = {
    subscribe: (topic, callback) => { subscriptions.set(topic, callback) },
    publish: (topic, payload, options) => { published.push({ topic, payload, options }) }
  }
  const bot = require('./virtual-thermostat')('livingRoomThermostat', { ...CONFIG, httpPost })
  const { version, default: defaultState, migrate } = bot.persistedCache
  const persistedCache = cache ?? (oldState
    ? migrate({ version, defaultState: structuredClone(defaultState), state: structuredClone(oldState) })
    : structuredClone(defaultState))
  bot.start({ mqtt, persistedCache, isEnabled })

  const deliver = (topic, payload) => {
    const callback = subscriptions.get(topic)
    if (typeof callback !== 'function') throw new Error(`no subscription for ${topic}`)
    callback(payload)
  }
  const thermostat = {
    persistedCache,
    // zigbee2mqtt adds last_seen (ISO time) to each message
    room: (temperature, lastSeen = Date.now()) =>
      deliver(CONFIG.roomTopic, { temperature, humidity: 45, linkquality: 120, last_seen: iso(lastSeen) }),
    outdoor: (temperature, time = Date.now()) => deliver(CONFIG.outdoorTopic, { temperature, time: iso(time) }),
    // `at: null` sends a reading without its time (_tz)
    controller: ({ targetTemp = 26, mode = 'heating', at = Date.now() } = {}) =>
      deliver(CONFIG.controllerTopic, { targetTemp, mode, s1Temp: 30.2, compEnabled: true, ...(at !== null && { _tz: at }) }),
    // Fresh data from all three inputs
    inputs: ({ room = 21.5, outdoor = 5, targetTemp = 26, mode = 'heating' } = {}) => {
      thermostat.room(room)
      if (outdoor != null) thermostat.outdoor(outdoor)
      thermostat.controller({ targetTemp, mode })
    },
    setPoint: (payload) => deliver(CONFIG.setTopic, payload),
    // Runs the timer to the next check
    check: () => jest.advanceTimersByTime(CONFIG.checkMs),
    writes: () => published.filter(m => m.topic === CONFIG.controllerWriteTopic).map(m => m.payload),
    statuses: () => published.filter(m => m.topic === CONFIG.statusTopic),
    status: () => thermostat.statuses().at(-1)?.payload,
    alerts: () => httpPost.mock.calls.map(([, body]) => body.message),
    logs: () => log.mock.calls.map((args) => args.join(' '))
  }
  return thermostat
}

// Keeps the room and the controller reporting for `ms`, as the real readers
// do (room every 2 min, controller every 5 min), with fixed values.
const keepReporting = (thermostat, ms, { room = 21.5, targetTemp = 26, mode = 'heating', withRoom = true, withController = true } = {}) => {
  for (let t = 0; t < ms; t += 2 * MIN) {
    jest.advanceTimersByTime(2 * MIN)
    if (withRoom) thermostat.room(room)
    if (withController) thermostat.controller({ targetTemp, mode })
  }
}

describe('virtual-thermostat (living room, #1753)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  describe('committed config', () => {
    test('reads the living-room sensor, the weather and the heat-pump controller', () => {
      expect(CONFIG).toMatchObject({
        type: 'virtual-thermostat',
        roomTopic: 'z2m/house1/living-temp-humid',
        outdoorTopic: 'homy/weather/current',
        controllerTopic: '/modbus/monitoring2/heatpump-ctrl/reading',
        controllerWriteTopic: '/modbus/monitoring2/heatpump-ctrl/write',
        setTopic: 'homy/thermostat/living_room/set',
        statusTopic: 'homy/thermostat/living_room/status'
      })
    })

    test('has the limits from #1753', () => {
      expect(CONFIG).toMatchObject({
        defaultSetPoint: 21.5,
        minSetPoint: 16,
        maxSetPoint: 26,
        model: { intercept: 11.5, perWater: 0.36, perOutdoor: 0.12 },
        roomGain: 2,
        minWater: 22,
        maxWater: 32,
        minChange: 1,
        checkMs: 10 * MIN,
        minWriteIntervalMs: 6 * HOUR,
        roomMaxAgeMs: 150 * MIN,
        controllerMaxAgeMs: 15 * MIN,
        writeSettleMs: 15 * MIN,
        outdoorMaxAgeMs: 1 * HOUR,
        outdoorMeanMs: 24 * HOUR,
        outdoorHoldMs: 12 * HOUR,
        outdoorMonthlyMeans: [3.7, 5.0, 7.6, 12.3, 16.7, 22.8, 26.1, 25.3, 20.1, 14.0, 9.5, 5.2]
      })
      expect(CONFIG).not.toHaveProperty('outdoorFallback')
    })
  })

  describe('water target', () => {
    test.each([
      ['room at the set point, 5 °C outside', 21.5, 5, 26],
      ['room 1 °C under the set point', 20.5, 5, 28],
      ['room 1 °C over the set point', 22.5, 5, 24],
      ['15 °C outside', 21.5, 15, 23],
      ['-5 °C outside', 21.5, -5, 29.5],
      ['a cold room on a cold day: not over maxWater', 18, -10, 32],
      ['a warm room on a warm day: not under minWater', 25, 20, 22]
    ])('%s', (_, room, outdoor, water) => {
      const thermostat = startBot()
      thermostat.inputs({ room, outdoor })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ setPoint: 21.5, roomTemp: room, outdoorTemp: outdoor, waterTarget: water })
    })

    test('goes up when the room is under the set point', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()

      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
    })

    test('goes up when it is colder outside', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, outdoor: -5, targetTemp: 26 })
      thermostat.check()

      expect(thermostat.writes()).toEqual([{ targetTemp: 29.5 }])
    })

    test('goes down when the room is over the set point', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 22.5, targetTemp: 26 })
      thermostat.check()

      expect(thermostat.writes()).toEqual([{ targetTemp: 24 }])
    })

    test('stays within minWater and maxWater', () => {
      const cold = startBot()
      cold.inputs({ room: 15, outdoor: -15, targetTemp: 26 })
      cold.check()
      expect(cold.writes()).toEqual([{ targetTemp: 32 }])

      const warm = startBot()
      warm.inputs({ room: 26, outdoor: 25, targetTemp: 26 })
      warm.check()
      expect(warm.writes()).toEqual([{ targetTemp: 22 }])
    })

    test('logs each write in one line with its reason', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, outdoor: 5, targetTemp: 26 })
      thermostat.check()

      const line = thermostat.logs().find((l) => l.includes('26 -> 28'))
      expect(line).toContain('set point 21.5')
      expect(line).toContain('room 20.5')
      expect(line).toContain('outdoor 5 (24 h mean)')
    })
  })

  describe('when it writes', () => {
    test('checks on the timer, not on each message', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5 })
      jest.advanceTimersByTime(CONFIG.checkMs - 1)
      expect(thermostat.writes()).toEqual([])
      expect(thermostat.statuses()).toEqual([])

      jest.advanceTimersByTime(1)
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
    })

    test('publishes the status retained after each check', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()

      const [status] = thermostat.statuses()
      expect(status.options).toMatchObject({ retain: true })
      expect(status.payload).toEqual({
        setPoint: 21.5,
        roomTemp: 20.5,
        outdoorTemp: 5,
        outdoorSource: '24 h mean',
        outdoorSampleCount: 1,
        waterTarget: 28,
        // the written value, until the next reading
        controllerTarget: 28,
        state: 'ok'
      })
      thermostat.check()
      expect(thermostat.statuses()).toHaveLength(2)
    })

    // A set point changed and changed back before the next reading must not
    // send the same value again outside the interval.
    test('takes the written value as the controller target until the next reading', () => {
      const thermostat = startBot()
      thermostat.outdoor(5)
      jest.advanceTimersByTime(9 * MIN)
      thermostat.room(21.5)
      thermostat.controller({ targetTemp: 24 })
      jest.advanceTimersByTime(1 * MIN)
      expect(thermostat.writes()).toEqual([{ targetTemp: 26 }])
      expect(thermostat.status()).toMatchObject({ controllerTarget: 26 })

      thermostat.setPoint({ setPoint: 22.5 })
      thermostat.setPoint({ setPoint: 21.5 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([{ targetTemp: 26 }])

      thermostat.controller({ targetTemp: 26.2 })
      expect(thermostat.status()).toMatchObject({ controllerTarget: 26 })
      thermostat.check()
      expect(thermostat.status()).toMatchObject({ controllerTarget: 26.2 })
    })

    test('does not write a change under minChange', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 27.1 })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ waterTarget: 28, state: 'ok' })
      expect(thermostat.writes()).toEqual([])
    })

    test('writes a change of exactly minChange', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 27 })
      thermostat.check()

      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
    })

    test('does not write again within minWriteIntervalMs', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])

      // The controller took 28; then the room cools further: 30 is wanted.
      keepReporting(thermostat, CONFIG.minWriteIntervalMs - 2 * MIN, { room: 19.5, targetTemp: 28 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
      expect(thermostat.status()).toMatchObject({ waterTarget: 30, controllerTarget: 28 })

      // The first check 6 h after the write
      keepReporting(thermostat, 10 * MIN, { room: 19.5, targetTemp: 28 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }, { targetTemp: 30 }])
    })

    test('keeps the time of the last write over a restart', () => {
      const first = startBot()
      first.inputs({ room: 20.5, targetTemp: 26 })
      first.check()
      expect(first.persistedCache.lastWriteAt).toBe(Date.now())

      jest.advanceTimersByTime(HOUR)
      const second = startBot({ cache: first.persistedCache, at: null })
      second.inputs({ room: 19.5, targetTemp: 28 })
      second.check()
      expect(second.writes()).toEqual([])
    })

    test('a set point change lets the next check write within the interval', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, targetTemp: 24 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([{ targetTemp: 26 }])

      // 5 h after the write, well within the 6 h
      keepReporting(thermostat, 5 * HOUR, { room: 21.5, targetTemp: 26 })
      thermostat.setPoint({ setPoint: 22.5 })
      keepReporting(thermostat, 10 * MIN, { room: 21.5, targetTemp: 26 })

      // needed 28.9 + 2 x 1 = 30.9
      expect(thermostat.writes()).toEqual([{ targetTemp: 26 }, { targetTemp: 31 }])
      expect(thermostat.logs().find((l) => l.includes('26 -> 31'))).toContain('set point 22.5')
    })

    test('the interval holds again after the check that followed a set point change', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, targetTemp: 24 })
      thermostat.check()
      thermostat.setPoint({ setPoint: 22.5 })
      keepReporting(thermostat, 10 * MIN, { room: 21.5, targetTemp: 26 })
      expect(thermostat.writes()).toHaveLength(2)

      keepReporting(thermostat, 60 * MIN, { room: 20.5, targetTemp: 31 })
      expect(thermostat.writes()).toHaveLength(2)
    })

    test('a set point change made while it cannot write still skips the interval later', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, targetTemp: 24 })
      thermostat.check()
      thermostat.setPoint({ setPoint: 22.5 })
      keepReporting(thermostat, 30 * MIN, { room: 21.5, targetTemp: 26, mode: 'cooling' })
      expect(thermostat.writes()).toEqual([{ targetTemp: 26 }])

      keepReporting(thermostat, 10 * MIN, { room: 21.5, targetTemp: 26 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 26 }, { targetTemp: 31 }])
    })

    // The framework drops the publish of a disabled bot, so the bot must not
    // count it as a write either.
    test('does nothing while disabled, and writes once enabled', () => {
      let enabled = false
      const thermostat = startBot({ isEnabled: () => enabled })
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([])
      expect(thermostat.persistedCache.lastWriteAt).toBeNull()

      enabled = true
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
    })

    test('does not write while the controller is not heating, and says so once', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, mode: 'cooling' })
      keepReporting(thermostat, HOUR, { room: 20.5, mode: 'cooling' })

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.status()).toMatchObject({ state: 'controller not heating' })
      expect(thermostat.logs().filter((l) => l.includes('not heating'))).toHaveLength(1)

      keepReporting(thermostat, 10 * MIN, { room: 20.5, mode: 'heating' })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
      expect(thermostat.logs().filter((l) => l.includes('heating again'))).toHaveLength(1)
    })

    test('does not write on old controller data, and says so once', () => {
      const thermostat = startBot()
      thermostat.room(20.5)
      thermostat.outdoor(5)
      thermostat.controller({ targetTemp: 26, at: Date.now() - 20 * MIN })
      keepReporting(thermostat, HOUR, { room: 20.5, withController: false })

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.status()).toMatchObject({ state: 'controller data old', controllerTarget: 26 })
      expect(thermostat.logs().filter((l) => l.includes('no heat-pump controller data'))).toHaveLength(1)

      keepReporting(thermostat, 10 * MIN, { room: 20.5 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
      expect(thermostat.logs().filter((l) => l.includes('controller data is back'))).toHaveLength(1)
    })
  })

  describe('old or missing room data', () => {
    test('does not write and says so once, with one Telegram message', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, targetTemp: 26 })
      // The sensor stops; later the controller target is changed by hand.
      keepReporting(thermostat, ROOM_OLD, { withRoom: false, targetTemp: 26 })
      keepReporting(thermostat, 4 * HOUR, { withRoom: false, targetTemp: 24 })

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.status()).toMatchObject({ state: 'room data old', roomTemp: 21.5, waterTarget: null, controllerTarget: 24 })
      const roomAlerts = thermostat.alerts().filter((a) => a.includes('living-room temperature'))
      expect(roomAlerts).toHaveLength(1)
      expect(roomAlerts[0]).toContain('no living-room temperature for 150 min')
      expect(thermostat.logs().filter((l) => l.includes('no living-room temperature'))).toHaveLength(1)
      // The change by hand has its own message
      expect(thermostat.alerts().filter((a) => a.includes('target is 24 °C'))).toHaveLength(1)
    })

    // The sensor reports at least once an hour, but gaps of 115 min were seen
    test.each([
      [140, 'ok'],
      [160, 'room data old']
    ])('a reading %p min old at the check: %s', (minutes, state) => {
      const thermostat = startBot()
      thermostat.room(21.5, Date.now() + CONFIG.checkMs - minutes * MIN)
      thermostat.outdoor(5)
      thermostat.controller({ targetTemp: 26 })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ state })
    })

    test('treats an old reading (last_seen) as old', () => {
      const thermostat = startBot()
      thermostat.room(20.5, Date.now() - ROOM_OLD)
      thermostat.outdoor(5)
      thermostat.controller({ targetTemp: 26 })
      thermostat.check()

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.status()).toMatchObject({ state: 'room data old' })
    })

    // The sensor reports on change and at least once an hour (#1753)
    test('a sensor that reports only once an hour is not old', () => {
      const thermostat = startBot()
      // The wanted target is the controller's 26, so nothing is written
      thermostat.outdoor(5)
      for (let hour = 0; hour < 6; hour++) {
        thermostat.room(21.5)
        keepReporting(thermostat, HOUR, { withRoom: false })
      }

      expect(thermostat.alerts()).toEqual([])
      expect(thermostat.statuses().map((m) => m.payload.state)).not.toContain('room data old')
    })

    test('does not write when the room never reported', () => {
      const thermostat = startBot()
      keepReporting(thermostat, HOUR, { withRoom: false, targetTemp: 20 })

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.status()).toMatchObject({ state: 'room data old', roomTemp: null, waterTarget: null })
    })

    test('says once when the data is back and writes again', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, targetTemp: 26 })
      keepReporting(thermostat, ROOM_OLD, { withRoom: false, targetTemp: 26 })

      keepReporting(thermostat, 10 * MIN, { room: 20.5, targetTemp: 26 })

      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
      expect(thermostat.alerts()).toHaveLength(2)
      expect(thermostat.alerts()[1]).toContain('living-room temperature is back')
    })

    test('ignores a message without a temperature', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 28 })
      keepReporting(thermostat, ROOM_OLD, { withRoom: false, targetTemp: 28 })
      // a message with only the battery level
      thermostat.room(undefined)
      keepReporting(thermostat, 10 * MIN, { withRoom: false, targetTemp: 26 })

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.status()).toMatchObject({ state: 'room data old', roomTemp: 20.5 })
    })
  })

  describe('set point', () => {
    test('starts at 21.5 and is kept in the persisted state', () => {
      const thermostat = startBot()
      expect(thermostat.persistedCache.setPoint).toBe(21.5)

      thermostat.setPoint({ setPoint: 23 })
      expect(thermostat.persistedCache.setPoint).toBe(23)

      const restarted = startBot({ cache: thermostat.persistedCache, at: null })
      restarted.inputs({ room: 23, targetTemp: 31 })
      restarted.check()
      expect(restarted.status()).toMatchObject({ setPoint: 23 })
    })

    test('publishes the status at once after a change', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 21.5, targetTemp: 26 })
      thermostat.setPoint({ setPoint: 22 })

      expect(thermostat.statuses()).toHaveLength(1)
      expect(thermostat.statuses()[0].options).toMatchObject({ retain: true })
      // needed 27.5 + 2 x 0.5
      expect(thermostat.status()).toMatchObject({ setPoint: 22, waterTarget: 28.5, state: 'ok' })
      expect(thermostat.writes()).toEqual([])
    })

    test.each([
      [30, 26],
      [10, 16],
      [21.3, 21.5],
      [21.2, 21],
      [22, 22]
    ])('takes %p as %p', (wanted, kept) => {
      const thermostat = startBot()
      thermostat.setPoint({ setPoint: wanted })

      expect(thermostat.persistedCache.setPoint).toBe(kept)
      expect(thermostat.status()).toMatchObject({ setPoint: kept })
    })

    test.each([
      [{ setPoint: '23' }],
      [{ setPoint: null }],
      [{ setPoint: true }],
      [{ temperature: 23 }],
      [null],
      [23],
      ['23']
    ])('ignores %p', (payload) => {
      const thermostat = startBot()
      thermostat.setPoint(payload)

      expect(thermostat.persistedCache.setPoint).toBe(21.5)
      expect(thermostat.persistedCache.setPointChanged).toBe(false)
      expect(thermostat.statuses()).toEqual([])
    })
  })

  describe('outdoor temperature', () => {
    // START is in November
    const NOVEMBER = CONFIG.outdoorMonthlyMeans?.[10]

    test('uses the mean of the weather values of the last 24 h', () => {
      const thermostat = startBot()
      thermostat.outdoor(2)
      jest.advanceTimersByTime(HOUR)
      thermostat.outdoor(4)
      jest.advanceTimersByTime(HOUR)
      thermostat.outdoor(9)
      thermostat.inputs({ outdoor: null, targetTemp: 26 })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ outdoorTemp: 5, outdoorSource: '24 h mean', outdoorSampleCount: 3, waterTarget: 26 })
    })

    test('rounds the mean to 0.1 °C', () => {
      const thermostat = startBot()
      thermostat.outdoor(1)
      jest.advanceTimersByTime(HOUR)
      thermostat.outdoor(2)
      jest.advanceTimersByTime(HOUR)
      thermostat.outdoor(2)
      thermostat.inputs({ outdoor: null })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ outdoorTemp: 1.7, outdoorSampleCount: 3 })
    })

    test('keeps fresh weather values in the persisted state', () => {
      const thermostat = startBot()
      thermostat.outdoor(15)
      jest.advanceTimersByTime(HOUR)
      thermostat.outdoor(13)

      expect(thermostat.persistedCache.outdoorSamples).toEqual([
        { temperature: 15, time: Date.now() - HOUR },
        { temperature: 13, time: Date.now() }
      ])
    })

    // The message is retained, so it comes again after each reconnect
    test('keeps a value with the same time only once', () => {
      const thermostat = startBot()
      const first = Date.now()
      thermostat.outdoor(2)
      jest.advanceTimersByTime(30 * MIN)
      thermostat.outdoor(8)
      thermostat.outdoor(8)
      thermostat.outdoor(2, first)
      thermostat.inputs({ outdoor: null })
      thermostat.check()

      expect(thermostat.persistedCache.outdoorSamples).toHaveLength(2)
      expect(thermostat.status()).toMatchObject({ outdoorTemp: 5, outdoorSampleCount: 2 })
    })

    test('drops values older than 24 h', () => {
      const thermostat = startBot()
      thermostat.outdoor(-20)
      jest.advanceTimersByTime(23 * HOUR)
      thermostat.outdoor(5)
      jest.advanceTimersByTime(HOUR)
      thermostat.inputs({ outdoor: null })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ outdoorTemp: 5, outdoorSource: '24 h mean', outdoorSampleCount: 1 })
      expect(thermostat.persistedCache.outdoorSamples).toEqual([{ temperature: 5, time: Date.now() - HOUR - CONFIG.checkMs }])
    })

    test('uses the mean while the newest value is up to 12 h old', () => {
      const thermostat = startBot()
      thermostat.inputs({ outdoor: 15, targetTemp: 23 })
      keepReporting(thermostat, 12 * HOUR, { targetTemp: 23 })

      expect(thermostat.status()).toMatchObject({ outdoorTemp: 15, outdoorSource: '24 h mean', outdoorSampleCount: 1, waterTarget: 23 })
      expect(thermostat.writes()).toEqual([])
    })

    test('uses the monthly average when the newest value is over 12 h old', () => {
      const thermostat = startBot()
      thermostat.inputs({ outdoor: 15, targetTemp: 23 })
      keepReporting(thermostat, 13 * HOUR, { targetTemp: 23 })

      expect(NOVEMBER).toBe(9.5)
      // needed 24.6
      expect(thermostat.status()).toMatchObject({ outdoorTemp: 9.5, outdoorSource: 'monthly average', outdoorSampleCount: 0, waterTarget: 24.5 })
      expect(thermostat.logs().filter((l) => l.includes('outdoor temperature from the monthly average'))).toHaveLength(1)
    })

    test('keeps the values over a restart', () => {
      const first = startBot()
      first.outdoor(2)
      jest.advanceTimersByTime(HOUR)
      first.outdoor(8)

      jest.advanceTimersByTime(2 * HOUR)
      const second = startBot({ cache: first.persistedCache, at: null })
      second.inputs({ outdoor: null, targetTemp: 26 })
      second.check()

      expect(second.status()).toMatchObject({ outdoorTemp: 5, outdoorSource: '24 h mean', outdoorSampleCount: 2, waterTarget: 26 })
    })

    // The version before kept only the last value, as `outdoor`
    test('takes the last value of the version before as its first value', () => {
      const lastWriteAt = Date.parse(START) - HOUR
      const time = Date.parse(START) - 2 * HOUR
      const thermostat = startBot({
        oldState: { setPoint: 22, setPointChanged: false, lastWriteAt, outdoor: { temperature: 15, time } }
      })

      expect(thermostat.persistedCache).toEqual({
        setPoint: 22,
        setPointChanged: false,
        lastWriteAt,
        outdoorSamples: [{ temperature: 15, time }],
        knownTarget: null
      })
      thermostat.inputs({ outdoor: null, targetTemp: 23 })
      thermostat.check()
      expect(thermostat.status()).toMatchObject({ outdoorTemp: 15, outdoorSource: '24 h mean', outdoorSampleCount: 1 })
      // The first target it sees is known, not a change
      expect(thermostat.alerts()).toEqual([])
    })

    test('starts with no values when the version before had none', () => {
      const thermostat = startBot({
        oldState: { setPoint: 21.5, setPointChanged: false, lastWriteAt: null, outdoor: null }
      })

      expect(thermostat.persistedCache).toMatchObject({ outdoorSamples: [] })
      expect(thermostat.persistedCache).not.toHaveProperty('outdoor')
    })

    // Another default in the config later
    test('keeps the values and the known target when the default changes', () => {
      const { migrate, default: defaultState } = require('./virtual-thermostat')('livingRoomThermostat', CONFIG).persistedCache
      const outdoorSamples = [{ temperature: 4, time: 1000 }, { temperature: 6, time: 2000 }]
      const state = { setPoint: 23, setPointChanged: false, lastWriteAt: 500, outdoorSamples, knownTarget: 27 }

      expect(migrate({ version: 2, defaultState: { ...defaultState, setPoint: 22 }, state: structuredClone(state) })).toEqual(state)
    })

    // A rollback to version 1 keeps the new keys, writes without the known
    // target and keeps its own last outdoor value
    test('after a rollback to the version before and a new deploy', () => {
      const { migrate, version, default: defaultState } = require('./virtual-thermostat')('livingRoomThermostat', CONFIG).persistedCache
      const state = {
        setPoint: 21.5,
        setPointChanged: false,
        lastWriteAt: 3000,
        outdoor: { temperature: 8, time: 3000 },
        outdoorSamples: [{ temperature: 4, time: 1000 }, { temperature: 6, time: 2000 }],
        knownTarget: 25
      }

      expect(migrate({ version, defaultState, state })).toEqual({
        setPoint: 21.5,
        setPointChanged: false,
        lastWriteAt: 3000,
        outdoorSamples: [{ temperature: 4, time: 1000 }, { temperature: 6, time: 2000 }, { temperature: 8, time: 3000 }],
        knownTarget: null
      })
    })

    test('does not keep a value that is already old when it arrives', () => {
      const thermostat = startBot()
      thermostat.outdoor(15)
      thermostat.outdoor(-3, Date.now() - 2 * HOUR)

      expect(thermostat.persistedCache.outdoorSamples).toEqual([{ temperature: 15, time: Date.now() }])
    })

    test('uses the monthly average when no weather data was ever seen', () => {
      const thermostat = startBot()
      thermostat.outdoor(15, Date.now() - 2 * HOUR)
      thermostat.inputs({ outdoor: null, targetTemp: 20 })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ outdoorTemp: NOVEMBER, outdoorSource: 'monthly average', waterTarget: 24.5 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 24.5 }])
      expect(thermostat.logs().find((l) => l.includes('20 -> 24.5'))).toContain('outdoor 9.5 (monthly average)')
      expect(thermostat.logs().filter((l) => l.includes('outdoor temperature from the monthly average'))).toHaveLength(1)
    })

    test.each([
      ['2026-01-15T12:00:00Z', 0],
      ['2026-07-15T12:00:00Z', 6],
      ['2026-12-15T12:00:00Z', 11]
    ])('takes the average of the month at %s', (at, month) => {
      const thermostat = startBot({ at })
      thermostat.inputs({ outdoor: null })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ outdoorTemp: CONFIG.outdoorMonthlyMeans?.[month], outdoorSource: 'monthly average' })
    })

    test('says once when the weather data is back', () => {
      const thermostat = startBot()
      thermostat.inputs({ outdoor: null, targetTemp: 26 })
      keepReporting(thermostat, HOUR)
      thermostat.outdoor(5)
      keepReporting(thermostat, HOUR - 2 * MIN)

      expect(thermostat.status()).toMatchObject({ outdoorSource: '24 h mean' })
      expect(thermostat.logs().filter((l) => l.includes('outdoor temperature from the weather data'))).toHaveLength(1)
    })

    // #1753: the model is a fit on daily means. With the hourly value, the
    // target followed the day and night swing and was written several times
    // a day.
    test('the swing between day and night does not move the water target', () => {
      const thermostat = startBot()
      const outdoorAt = (hour) => 5 + 6 * Math.sin((2 * Math.PI * hour) / 24)
      let writesAfterOneDay = null
      for (let hour = 0; hour < 48; hour++) {
        if (hour === 24) writesAfterOneDay = thermostat.writes().length
        thermostat.outdoor(outdoorAt(hour))
        for (let minute = 0; minute < 60; minute += 2) {
          // The controller shows the last written target
          thermostat.room(21.5)
          thermostat.controller({ targetTemp: thermostat.writes().at(-1)?.targetTemp ?? 26 })
          jest.advanceTimersByTime(2 * MIN)
        }
      }

      // The second day, when the mean has a full day of values
      const secondDay = thermostat.statuses().slice(-24 * 6).map((m) => m.payload)
      const targets = secondDay.map((status) => status.waterTarget)
      expect(Math.max(...targets) - Math.min(...targets)).toBeLessThan(CONFIG.minChange)
      expect(thermostat.writes()).toHaveLength(writesAfterOneDay)
      // The hourly value alone would move the target by 4 °C
      const hourly = Array.from({ length: 24 }, (_, hour) => outdoorAt(hour))
      expect((Math.max(...hourly) - Math.min(...hourly)) * CONFIG.model.perOutdoor / CONFIG.model.perWater).toBeGreaterThan(3.9)
      expect(thermostat.alerts()).toEqual([])
    })
  })

  describe('a water target the bot did not write', () => {
    test('takes the first target it sees as known, without a message', () => {
      const thermostat = startBot()
      thermostat.inputs({ targetTemp: 26.5 })
      keepReporting(thermostat, HOUR, { targetTemp: 26.5 })

      expect(thermostat.persistedCache.knownTarget).toBe(26.5)
      expect(thermostat.alerts()).toEqual([])
    })

    test('says so once in the log and once on Telegram', () => {
      const thermostat = startBot()
      thermostat.inputs({ targetTemp: 26 })
      keepReporting(thermostat, 30 * MIN, { targetTemp: 26 })
      // Less than minChange from the wanted 26, so the bot does not write
      keepReporting(thermostat, 2 * HOUR, { targetTemp: 26.5 })

      expect(thermostat.writes()).toEqual([])
      expect(thermostat.alerts()).toEqual([expect.stringContaining('heat-pump water target is 26.5 °C, not the 26 °C this bot last wrote or saw')])
      expect(thermostat.logs().filter((l) => l.includes('this bot last wrote or saw'))).toHaveLength(1)
      expect(thermostat.persistedCache.knownTarget).toBe(26.5)
    })

    test('says so for each new change', () => {
      const thermostat = startBot()
      thermostat.inputs({ targetTemp: 26 })
      keepReporting(thermostat, 30 * MIN, { targetTemp: 26.5 })
      keepReporting(thermostat, 30 * MIN, { targetTemp: 25.5 })

      expect(thermostat.alerts()).toEqual([
        expect.stringContaining('target is 26.5 °C, not the 26 °C'),
        expect.stringContaining('target is 25.5 °C, not the 26.5 °C')
      ])
    })

    // Readings already on the way may still show the old target
    test('no message for readings soon after its own write', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])

      keepReporting(thermostat, CONFIG.writeSettleMs - 2 * MIN, { room: 20.5, targetTemp: 26 })
      keepReporting(thermostat, HOUR, { room: 20.5, targetTemp: 28 })

      expect(thermostat.alerts()).toEqual([])
      expect(thermostat.persistedCache.knownTarget).toBe(28)
    })

    // No hold: the bot does not stop for a change by hand
    test('keeps its normal schedule after a change', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      keepReporting(thermostat, HOUR, { room: 20.5, targetTemp: 28 })
      keepReporting(thermostat, CONFIG.minWriteIntervalMs - HOUR - 2 * MIN, { room: 20.5, targetTemp: 24 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
      expect(thermostat.alerts()).toEqual([expect.stringContaining('target is 24 °C, not the 28 °C')])
      expect(thermostat.alerts()[0]).toContain('The bot may change it again at its next write.')

      keepReporting(thermostat, 10 * MIN, { room: 20.5, targetTemp: 24 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }, { targetTemp: 28 }])
      expect(thermostat.alerts()).toHaveLength(1)
    })

    test('a write that did not arrive: one message once the time after the write is over', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])

      keepReporting(thermostat, CONFIG.writeSettleMs - 2 * MIN, { room: 20.5, targetTemp: 26 })
      expect(thermostat.alerts()).toEqual([])
      keepReporting(thermostat, HOUR, { room: 20.5, targetTemp: 26 })
      expect(thermostat.alerts()).toEqual([expect.stringContaining('target is 26 °C, not the 28 °C')])
    })

    test('says nothing of a next write while the controller is not heating', () => {
      const thermostat = startBot()
      thermostat.inputs({ targetTemp: 26, mode: 'cooling' })
      thermostat.controller({ targetTemp: 20, mode: 'cooling' })

      expect(thermostat.alerts()).toHaveLength(1)
      expect(thermostat.alerts()[0]).not.toContain('next write')
    })

    test('a reading without its time counts as made now', () => {
      const thermostat = startBot()
      thermostat.inputs({ room: 20.5, targetTemp: 26 })
      thermostat.check()
      thermostat.controller({ targetTemp: 26, at: null })
      expect(thermostat.alerts()).toEqual([])

      jest.advanceTimersByTime(CONFIG.writeSettleMs)
      thermostat.controller({ targetTemp: 26, at: null })
      expect(thermostat.alerts()).toEqual([expect.stringContaining('target is 26 °C, not the 28 °C')])
    })

    // After a restart, a reading made before the last write may come late
    test('no message for a reading made before its own write', () => {
      const first = startBot()
      first.inputs({ room: 20.5, targetTemp: 26 })
      first.check()
      const writtenAt = first.persistedCache.lastWriteAt

      jest.advanceTimersByTime(HOUR)
      const second = startBot({ cache: first.persistedCache, at: null })
      second.controller({ targetTemp: 26, at: writtenAt - 2 * MIN })
      second.controller({ targetTemp: 28 })

      expect(second.alerts()).toEqual([])
      expect(second.persistedCache.knownTarget).toBe(28)
    })

    // The version before did not keep the target it wrote
    test('does not take the first target as known soon after a write of the version before', () => {
      const thermostat = startBot({
        oldState: { setPoint: 21.5, setPointChanged: false, lastWriteAt: Date.parse(START) - 5 * MIN, outdoor: null }
      })
      thermostat.controller({ targetTemp: 26 })
      keepReporting(thermostat, HOUR, { targetTemp: 28 })

      expect(thermostat.persistedCache.knownTarget).toBe(28)
      expect(thermostat.alerts().filter((a) => a.includes('this bot last wrote or saw'))).toEqual([])
    })

    test('keeps the known target over a restart', () => {
      const first = startBot()
      first.inputs({ targetTemp: 26 })

      jest.advanceTimersByTime(HOUR)
      const second = startBot({ cache: first.persistedCache, at: null })
      second.controller({ targetTemp: 26.5 })

      expect(second.alerts()).toEqual([expect.stringContaining('target is 26.5 °C, not the 26 °C')])
    })
  })
})
