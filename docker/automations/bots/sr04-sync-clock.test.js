const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')

const TOPIC = '/modbus/test/solar_heater'
const READING = `${TOPIC}/reading`
const WRITE = `${TOPIC}/write`
const MIN = 60 * 1000

// All times are UTC instants, so the tests do not depend on the time zone of
// the test run. The comments give the wall clock in Europe/Sofia.
// Tue 2026-10-20 14:01:27 local (summer time, UTC+3)
const NOW = Date.parse('2026-10-20T11:01:27Z')
// The live reading at NOW: the controller 1 h 20 min 48 s ahead
const AHEAD = {ss: 15, mm: 22, hh: 15, dayWeek: 2, day: 20, month: 10, year: 26}
// The controller's clock right at NOW
const RIGHT = {ss: 27, mm: 1, hh: 14, dayWeek: 2, day: 20, month: 10, year: 26}

describe('sr04-sync-clock bot', () => {
  let mqtt
  let subscribers
  let log

  const startBot = (config = {}) => {
    const createBot = require('./sr04-sync-clock')
    const bot = createBot('test-solar-clock', {topic: TOPIC, ...config})
    return bot.start({mqtt})
  }
  const reading = (timer, at = Date.now()) => subscribers[READING]({t1: 45.5, timer, _tz: at})
  const writes = () => mqtt.publish.mock.calls.filter(([topic]) => topic === WRITE).map(([, payload]) => payload)
  // The timer `seconds` away from RIGHT; positive is ahead
  const off = (seconds) => {
    const time = new Date(Date.UTC(2026, 9, 20, 14, 1, 27) + seconds * 1000)
    return {
      ss: time.getUTCSeconds(),
      mm: time.getUTCMinutes(),
      hh: time.getUTCHours(),
      dayWeek: time.getUTCDay(),
      day: time.getUTCDate(),
      month: time.getUTCMonth() + 1,
      year: time.getUTCFullYear() % 100,
    }
  }

  beforeEach(() => {
    jest.useFakeTimers({now: NOW})
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
    subscribers = {}
    mqtt = {
      subscribe: jest.fn((topic, callback) => { subscribers[topic] = callback }),
      publish: jest.fn(),
    }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('listens to the readings of the controller', async () => {
    await startBot()

    expect(Object.keys(subscribers)).toEqual([READING])
  })

  it('sets the clock to the local time when it is 1 h 20 min ahead', async () => {
    await startBot()

    reading(AHEAD)

    expect(writes()).toEqual([{timer: RIGHT}])
  })

  it('logs one line with the old time, the new time and the drift', async () => {
    await startBot()

    reading(AHEAD)

    expect(log).toHaveBeenCalledTimes(1)
    const [line] = log.mock.calls[0]
    expect(line).toContain('2026-10-20 15:22:15')
    expect(line).toContain('2026-10-20 14:01:27')
    expect(line).toContain('4848 s')
  })

  describe('leaves a clock within the tolerance alone', () => {
    it.each([0, 23, 30, -30])('%i s off', async (seconds) => {
      await startBot()

      reading(off(seconds))

      expect(writes()).toEqual([])
      expect(log).not.toHaveBeenCalled()
    })
  })

  describe('sets a clock past the tolerance', () => {
    it.each([31, -31, 24 * 60 * 60])('%i s off', async (seconds) => {
      await startBot()

      reading(off(seconds))

      expect(writes()).toEqual([{timer: RIGHT}])
    })
  })

  it('takes the tolerance from the config', async () => {
    await startBot({maxDriftSeconds: 10})

    reading(off(11))

    expect(writes()).toEqual([{timer: RIGHT}])
  })

  it('sets a clock with only the week day wrong', async () => {
    await startBot()

    reading({...RIGHT, dayWeek: 3})

    expect(writes()).toEqual([{timer: RIGHT}])
  })

  it('leaves a clock a few seconds behind alone just after midnight', async () => {
    // Wed 2026-10-21 00:00:08 local; the controller still shows Tuesday
    const at = Date.parse('2026-10-20T21:00:08Z')
    jest.setSystemTime(at)
    await startBot()

    reading({ss: 58, mm: 59, hh: 23, dayWeek: 2, day: 20, month: 10, year: 26}, at)

    expect(writes()).toEqual([])
  })

  it('compares the clock with the time of the reading, not the time now', async () => {
    await startBot()
    jest.setSystemTime(NOW + 2 * MIN)

    reading(RIGHT, NOW)

    expect(writes()).toEqual([])
  })

  it('writes the new day, month and year after midnight on New Year', async () => {
    // Fri 2027-01-01 00:00:07 local (winter time, UTC+2)
    const at = Date.parse('2026-12-31T22:00:07Z')
    jest.setSystemTime(at)
    await startBot()

    reading({ss: 7, mm: 0, hh: 1, dayWeek: 5, day: 1, month: 1, year: 27}, at)

    expect(writes()).toEqual([{timer: {ss: 7, mm: 0, hh: 0, dayWeek: 5, day: 1, month: 1, year: 27}}])
  })

  describe('follows the change of summer time', () => {
    it('to winter time, when the controller still shows summer time', async () => {
      // Sun 2026-10-25 03:30:20 local, after the clocks went back from 04:00
      const at = Date.parse('2026-10-25T01:30:20Z')
      jest.setSystemTime(at)
      await startBot()

      reading({ss: 20, mm: 30, hh: 4, dayWeek: 0, day: 25, month: 10, year: 26}, at)

      expect(writes()).toEqual([{timer: {ss: 20, mm: 30, hh: 3, dayWeek: 0, day: 25, month: 10, year: 26}}])
    })

    it('not in the first 03:30, before the clocks go back', async () => {
      // Sun 2026-10-25 03:30:20 local summer time, one hour before the case above
      const at = Date.parse('2026-10-25T00:30:20Z')
      jest.setSystemTime(at)
      await startBot()

      reading({ss: 20, mm: 30, hh: 3, dayWeek: 0, day: 25, month: 10, year: 26}, at)

      expect(writes()).toEqual([])
    })

    it('to summer time, when the controller still shows winter time', async () => {
      // Sun 2027-03-28 04:30:20 local, after the clocks went forward from 03:00
      const at = Date.parse('2027-03-28T01:30:20Z')
      jest.setSystemTime(at)
      await startBot()

      reading({ss: 20, mm: 30, hh: 3, dayWeek: 0, day: 28, month: 3, year: 27}, at)

      expect(writes()).toEqual([{timer: {ss: 20, mm: 30, hh: 4, dayWeek: 0, day: 28, month: 3, year: 27}}])
    })
  })

  it('uses the time zone from the config, not the one of the process', async () => {
    // 14:01:27 in Europe/Sofia is 07:01:27 in America/New_York, the same day
    await startBot({timeZone: 'America/New_York'})

    reading(AHEAD)

    expect(writes()).toEqual([{timer: {...RIGHT, hh: 7}}])
  })

  describe('waits for a later reading when the seconds are near a full minute', () => {
    it.each([
      ['00', '2026-10-20T11:02:00Z'],
      ['04', '2026-10-20T11:02:04Z'],
      ['51', '2026-10-20T11:01:51Z'],
      ['59', '2026-10-20T11:01:59Z'],
    ])('at :%s', async (_, now) => {
      await startBot()
      jest.setSystemTime(Date.parse(now))

      reading(AHEAD, NOW)

      expect(writes()).toEqual([])
    })

    it('and writes at :05', async () => {
      await startBot()

      jest.setSystemTime(Date.parse('2026-10-20T11:01:59Z'))
      reading(AHEAD, NOW)
      jest.setSystemTime(Date.parse('2026-10-20T11:02:05Z'))
      reading(AHEAD, NOW)

      expect(writes()).toEqual([{timer: {...RIGHT, ss: 5, mm: 2}}])
    })

    it('and writes at :50', async () => {
      await startBot()

      jest.setSystemTime(Date.parse('2026-10-20T11:01:50Z'))
      reading(AHEAD, NOW)

      expect(writes()).toEqual([{timer: {...RIGHT, ss: 50}}])
    })
  })

  it('writes at most once in 15 min', async () => {
    await startBot()

    reading(AHEAD)
    // The readings already on their way still show the old time
    jest.setSystemTime(NOW + 14 * MIN)
    reading(AHEAD, NOW)
    expect(writes()).toHaveLength(1)

    // The write did not reach the controller
    jest.setSystemTime(NOW + 15 * MIN)
    reading(AHEAD, NOW)
    expect(writes()).toEqual([{timer: RIGHT}, {timer: {...RIGHT, mm: 16}}])
  })

  it('takes the time between writes from the config', async () => {
    await startBot({minWriteIntervalMs: MIN})

    reading(AHEAD)
    jest.setSystemTime(NOW + MIN)
    reading(AHEAD, NOW)

    expect(writes()).toHaveLength(2)
  })

  describe('ignores a reading without a full clock', () => {
    const without = (field) => {
      const timer = {...AHEAD}
      delete timer[field]
      return timer
    }

    it.each([
      ['null', null],
      ['no _tz', {timer: AHEAD}],
      ['a _tz that is not a number', {timer: AHEAD, _tz: '2026-10-20T11:01:27Z'}],
      ['no timer', {t1: 45.5, _tz: NOW}],
      ['a timer that is not an object', {timer: '15:22:15', _tz: NOW}],
      ...['ss', 'mm', 'hh', 'dayWeek', 'day', 'month', 'year'].map((field) => [`no ${field}`, {timer: without(field), _tz: NOW}]),
      ['a null field', {timer: {...AHEAD, hh: null}, _tz: NOW}],
    ])('%s', async (_, payload) => {
      await startBot()

      subscribers[READING](payload)

      expect(writes()).toEqual([])
    })
  })
})
