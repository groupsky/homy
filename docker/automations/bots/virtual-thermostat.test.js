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
// earlier run; without it the bot starts with its defaults.
const startBot = ({ cache, at = START, isEnabled = () => true } = {}) => {
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
  const persistedCache = cache ?? structuredClone(bot.persistedCache.default)
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
    controller: ({ targetTemp = 26, mode = 'heating', at = Date.now() } = {}) =>
      deliver(CONFIG.controllerTopic, { targetTemp, mode, s1Temp: 30.2, compEnabled: true, _tz: at }),
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
        minWriteIntervalMs: 3 * HOUR,
        roomMaxAgeMs: 90 * MIN,
        controllerMaxAgeMs: 15 * MIN,
        outdoorMaxAgeMs: 1 * HOUR,
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
      expect(line).toContain('outdoor 5 (weather)')
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
        outdoorSource: 'weather',
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
      keepReporting(thermostat, 3 * HOUR - 2 * MIN, { room: 19.5, targetTemp: 28 })
      expect(thermostat.writes()).toEqual([{ targetTemp: 28 }])
      expect(thermostat.status()).toMatchObject({ waterTarget: 30, controllerTarget: 28 })

      // The first check 3 h after the write
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

      keepReporting(thermostat, 30 * MIN, { room: 21.5, targetTemp: 26 })
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
      expect(thermostat.alerts()).toHaveLength(1)
      expect(thermostat.alerts()[0]).toContain('no living-room temperature for 90 min')
      expect(thermostat.logs().filter((l) => l.includes('no living-room temperature'))).toHaveLength(1)
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

    test('uses fresh weather data and keeps it in the persisted state', () => {
      const thermostat = startBot()
      thermostat.inputs({ outdoor: 15 })
      thermostat.check()

      expect(thermostat.status()).toMatchObject({ outdoorTemp: 15, outdoorSource: 'weather', waterTarget: 23 })
      expect(thermostat.persistedCache.outdoor).toEqual({ temperature: 15, time: Date.now() - CONFIG.checkMs })
    })

    test('holds the last value when the weather data is 2 h old', () => {
      const thermostat = startBot()
      thermostat.inputs({ outdoor: 15, targetTemp: 23 })
      keepReporting(thermostat, 2 * HOUR, { targetTemp: 23 })

      expect(thermostat.status()).toMatchObject({ outdoorTemp: 15, outdoorSource: 'last value', waterTarget: 23 })
      expect(thermostat.writes()).toEqual([])
      expect(thermostat.logs().filter((l) => l.includes('outdoor temperature from the last value'))).toHaveLength(1)
    })

    test('uses the monthly average when the last value is 13 h old', () => {
      const thermostat = startBot()
      thermostat.inputs({ outdoor: 15, targetTemp: 23 })
      keepReporting(thermostat, 13 * HOUR, { targetTemp: 23 })

      expect(NOVEMBER).toBe(9.5)
      // needed 24.6
      expect(thermostat.status()).toMatchObject({ outdoorTemp: 9.5, outdoorSource: 'monthly average', waterTarget: 24.5 })
      expect(thermostat.logs().filter((l) => l.includes('outdoor temperature from the monthly average'))).toHaveLength(1)
    })

    test('holds the last value over a restart', () => {
      const first = startBot()
      first.outdoor(15)

      jest.advanceTimersByTime(2 * HOUR)
      const second = startBot({ cache: first.persistedCache, at: null })
      second.inputs({ outdoor: null, targetTemp: 23 })
      second.check()

      expect(second.status()).toMatchObject({ outdoorTemp: 15, outdoorSource: 'last value', waterTarget: 23 })
    })

    test('does not keep a value that is already old when it arrives', () => {
      const thermostat = startBot()
      thermostat.outdoor(15)
      thermostat.outdoor(-3, Date.now() - 2 * HOUR)

      expect(thermostat.persistedCache.outdoor).toEqual({ temperature: 15, time: Date.now() })
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

      expect(thermostat.status()).toMatchObject({ outdoorSource: 'weather' })
      expect(thermostat.logs().filter((l) => l.includes('outdoor temperature from the weather data'))).toHaveLength(1)
    })
  })
})
