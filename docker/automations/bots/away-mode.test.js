const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const A = '/modbus/test/thermostat-a'
const B = '/modbus/test/thermostat-b'
const C = '/modbus/test/thermostat-c'
const TOPICS = {
  thermostatTopics: [A, B, C],
  livingRoomSetTopic: 'test/living/set',
  livingRoomStatusTopic: 'test/living/status',
  boilerSetTopic: 'test/boiler/set',
  boilerStatusTopic: 'test/boiler/status',
  switchSetTopic: 'test/away/set',
  switchStatusTopic: 'test/away/status',
  returnDateSetTopic: 'test/date/set',
  returnDateStatusTopic: 'test/date/status'
}

// Local times in Sofia in winter (+02:00), so the tests do not depend on the
// time zone of the machine
const at = (iso) => new Date(iso).getTime()
const NOW = at('2026-11-02T10:00:00+02:00')
// Return on 2026-11-20: rooms back on 11-17, boiler on 11-19 at 18:00
const RETURN = at('2026-11-20T00:00:00+02:00')

describe('away-mode bot', () => {
  let subscribers
  let published
  let persistedCache
  let httpPost
  let enabled

  const start = (config = {}) => {
    subscribers = {}
    const bot = require('./away-mode')('away', { ...TOPICS, httpPost, ...config })
    persistedCache = persistedCache ?? structuredClone(bot.persistedCache.default)
    const mqtt = {
      subscribe: jest.fn((topic, callback) => { subscribers[topic] = callback }),
      publish: jest.fn((topic, payload, options) => { published.push({ topic, payload, options }) })
    }
    bot.start({ mqtt, persistedCache, isEnabled: () => enabled })
  }

  const deliver = (topic, payload) => subscribers[topic](payload)
  const reading = (topic, values, time = Date.now()) =>
    deliver(`${topic}/reading`, { mode: 'heating', targetTemp: 21.5, ...values, _tz: time })
  const living = (setPoint) => deliver(TOPICS.livingRoomStatusTopic, { setPoint })
  const boiler = (mode) => deliver(TOPICS.boilerStatusTopic, { mode })
  const press = (state) => deliver(TOPICS.switchSetTopic, { state, _src: 'ha' })
  const setDate = (value) => deliver(TOPICS.returnDateSetTopic, { value, _src: 'ha' })
  const at2 = (time) => jest.setSystemTime(time)
  const advance = (ms) => jest.advanceTimersByTime(ms)

  const to = (topic) => published.filter((m) => m.topic === topic).map((m) => m.payload)
  const roomWrites = (topic) => to(`${topic}/write`)
  const livingWrites = () => to(TOPICS.livingRoomSetTopic)
  const boilerCommands = () => to(TOPICS.boilerSetTopic)
  const switchStatus = () => to(TOPICS.switchStatusTopic).at(-1)
  const dateStatus = () => to(TOPICS.returnDateStatusTopic).at(-1)
  const messages = () => httpPost.mock.calls.map(([, body]) => body.message)
  const clear = () => { published.length = 0; httpPost.mockClear() }

  // Three rooms, two heating (22 and 21.5) and one cooling, the living room at 21.5
  const house = (extra = {}) => {
    reading(A, { targetTemp: 22 })
    reading(B, { targetTemp: 21.5 })
    reading(C, { mode: 'cooling', targetTemp: 25 })
    living(21.5)
    boiler('automatic')
    return extra
  }
  // Away with the return date, then clear what was published
  const goAway = (date = '2026-11-20') => {
    house()
    if (date) setDate(date)
    press(true)
    // The boiler shows the mode it was given
    if (boilerCommands().length > 0) boiler(boilerCommands().at(-1).mode)
    clear()
  }
  // The thermostats show the setback values, as after a successful write
  const showSetback = () => {
    reading(A, { targetTemp: 19 })
    reading(B, { targetTemp: 18.5 })
    living(18.5)
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    published = []
    persistedCache = undefined
    enabled = true
    httpPost = jest.fn().mockResolvedValue({ ok: true })
    start()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('turning on', () => {
    it('sets heating rooms back 3 K, leaves cooling rooms, and sets the boiler to end 6 h before the return', () => {
      house()
      setDate('2026-11-20')
      press(true)

      expect(roomWrites(A)).toEqual([{ targetTemp: 19 }])
      expect(roomWrites(B)).toEqual([{ targetTemp: 18.5 }])
      expect(roomWrites(C)).toEqual([])
      expect(livingWrites()).toEqual([{ setPoint: 18.5 }])
      expect(boilerCommands()).toEqual([{ mode: 'vacation_until', until: RETURN - 6 * HOUR }])
      expect(switchStatus()).toEqual({ state: true })
      expect(published.find((m) => m.topic === TOPICS.switchStatusTopic).options).toEqual({ retain: true })
      expect(messages()).toHaveLength(1)
    })

    it('writes only the set point to a thermostat, never a mode or the power', () => {
      goAway()
      showSetback()
      press(false)
      const writes = published.filter((m) => m.topic.endsWith('/write'))
      expect(writes.length).toBeGreaterThan(0)
      for (const { payload } of writes) expect(Object.keys(payload)).toEqual(['targetTemp'])
    })

    it('keeps the living room set point at 16 at the lowest', () => {
      living(17)
      reading(A, { targetTemp: 22 })
      press(true)
      expect(livingWrites()).toEqual([{ setPoint: 16 }])
    })

    it('does not write the living room when it is at the lowest already', () => {
      living(16)
      reading(A, { targetTemp: 22 })
      press(true)
      expect(livingWrites()).toEqual([])
      living(16.5)
      press(false)
    })

    it('uses vacation_14d without a return date', () => {
      house()
      press(true)

      expect(boilerCommands()).toEqual([{ mode: 'vacation_14d' }])
      expect(roomWrites(A)).toEqual([{ targetTemp: 19 }])
    })

    it('sets back no room when the return is within 3 days, only the boiler', () => {
      house()
      setDate('2026-11-04')
      press(true)

      expect(roomWrites(A)).toEqual([])
      expect(roomWrites(B)).toEqual([])
      expect(livingWrites()).toEqual([])
      expect(boilerCommands()).toEqual([{ mode: 'vacation_until', until: at('2026-11-03T18:00:00+02:00') }])
      expect(switchStatus()).toEqual({ state: true })
    })

    it('leaves the boiler alone when the boiler end is not in the future', () => {
      at2(at('2026-11-02T20:00:00+02:00'))
      house()
      setDate('2026-11-03')
      press(true)

      expect(boilerCommands()).toEqual([])
      expect(switchStatus()).toEqual({ state: true })
    })

    it('does nothing new when it is already on', () => {
      goAway()
      press(true)

      expect(roomWrites(A)).toEqual([])
      expect(boilerCommands()).toEqual([])
      expect(messages()).toEqual([])
      expect(switchStatus()).toEqual({ state: true })
    })

    it('skips and reports rooms with an old or missing reading', () => {
      at2(NOW - 11 * MIN)
      reading(A, { targetTemp: 22 })
      at2(NOW)
      reading(B, { targetTemp: 21.5 })
      living(21.5)
      press(true)

      expect(roomWrites(A)).toEqual([])
      expect(roomWrites(B)).toEqual([{ targetTemp: 18.5 }])
      expect(roomWrites(C)).toEqual([])
      expect(messages()[0]).toMatch(/thermostat-a: no fresh reading/)
      expect(messages()[0]).toMatch(/thermostat-c: no fresh reading/)
    })

    it('takes a reading of exactly 10 minutes as fresh', () => {
      at2(NOW - 10 * MIN)
      reading(A, { targetTemp: 22 })
      at2(NOW)
      press(true)
      expect(roomWrites(A)).toEqual([{ targetTemp: 19 }])
    })

    it('reports a living room without a set point', () => {
      reading(A, { targetTemp: 22 })
      press(true)
      expect(livingWrites()).toEqual([])
      expect(messages()[0]).toMatch(/living room: no set point/)
    })
  })

  describe('the return date', () => {
    it.each([
      ['not a date', 'tomorrow'],
      ['a date that does not exist', '2026-02-31'],
      ['a date in the past', '2026-11-01'],
      ['today', '2026-11-02'],
      ['over 60 days ahead', '2027-02-01']
    ])('refuses %s and shows the old value again', (_, value) => {
      setDate('2026-11-20')
      clear()
      setDate(value)

      expect(persistedCache.returnDate).toBe('2026-11-20')
      expect(dateStatus()).toEqual({ value: '2026-11-20' })
    })

    it('is published as a retained status, also empty', () => {
      setDate('2026-11-20')
      expect(dateStatus()).toEqual({ value: '2026-11-20' })
      setDate('')
      expect(dateStatus()).toEqual({ value: '' })
    })

    it('counts the return from 00:00 local time, also over the summer time change', () => {
      const { localMidnight } = require('./away-mode')
      expect(localMidnight('2026-11-20', 'Europe/Sofia')).toBe(RETURN)
      expect(localMidnight('2026-07-01', 'Europe/Sofia')).toBe(at('2026-07-01T00:00:00+03:00'))
      expect(localMidnight('2026-10-25', 'Europe/Sofia')).toBe(at('2026-10-25T00:00:00+03:00'))
      expect(localMidnight('2026-10-26', 'Europe/Sofia')).toBe(at('2026-10-26T00:00:00+02:00'))
    })

    it('reschedules when it changes while away, without saving the values again', () => {
      goAway()
      setDate('2026-11-25')

      expect(boilerCommands()).toEqual([{ mode: 'vacation_until', until: at('2026-11-24T18:00:00+02:00') }])
      expect(roomWrites(A)).toEqual([])
      expect(persistedCache.rooms[A]).toEqual({ home: 22, setback: 19 })

      // The old time passes: nothing happens
      showSetback()
      clear()
      at2(at('2026-11-17T00:00:30+02:00'))
      reading(A, { targetTemp: 19 })
      advance(2 * MIN)
      expect(roomWrites(A)).toEqual([])

      // The rooms go back 3 days before the new date
      at2(at('2026-11-21T23:59:00+02:00'))
      reading(A, { targetTemp: 19 })
      reading(B, { targetTemp: 18.5 })
      living(18.5)
      advance(2 * MIN)
      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
    })

    it('puts the rooms back at once when the new date is within 3 days', () => {
      goAway()
      showSetback()
      setDate('2026-11-04')

      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(livingWrites()).toEqual([{ setPoint: 21.5 }])
      expect(boilerCommands()).toEqual([{ mode: 'vacation_until', until: at('2026-11-03T18:00:00+02:00') }])
    })

    it('releases the boiler when the new boiler end is already past', () => {
      at2(at('2026-11-02T20:00:00+02:00'))
      goAway('2026-11-20')
      boiler('vacation_until')
      setDate('2026-11-03')

      expect(boilerCommands()).toEqual([{ mode: 'automatic' }])
    })

    it('goes to vacation_14d when the date is cleared while away', () => {
      goAway()
      setDate('')
      expect(boilerCommands()).toEqual([{ mode: 'vacation_14d' }])
      expect(persistedCache.away).toBe(true)
    })

    it('leaves a boiler mode changed by hand alone when the date changes', () => {
      goAway()
      boiler('manual_on')
      setDate('2026-11-25')
      expect(boilerCommands()).toEqual([])
    })
  })

  describe('the schedule', () => {
    it('puts the rooms back 3 days before the return, only where the value is still the setback', () => {
      goAway()
      showSetback()
      clear()
      at2(at('2026-11-16T23:58:00+02:00'))
      reading(A, { targetTemp: 19 })
      reading(B, { targetTemp: 18.5 })
      living(18.5)
      advance(MIN)
      expect(roomWrites(A)).toEqual([])

      advance(2 * MIN)
      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(roomWrites(C)).toEqual([])
      expect(livingWrites()).toEqual([{ setPoint: 21.5 }])
      expect(boilerCommands()).toEqual([])
      expect(switchStatus()).toBeUndefined()
      expect(messages()).toHaveLength(1)
      expect(messages()[0]).toMatch(/thermostat-a: 19 -> 22/)

      // Only once, when the thermostats show the home values
      reading(A, { targetTemp: 22 })
      reading(B, { targetTemp: 21.5 })
      living(21.5)
      clear()
      advance(10 * MIN)
      expect(roomWrites(A)).toEqual([])
    })

    it('turns itself off at the return and puts back whatever is left', () => {
      goAway()
      showSetback()
      // The 3-day step finds no fresh reading in room A, so A stays for later
      at2(at('2026-11-16T23:59:00+02:00'))
      reading(B, { targetTemp: 18.5 })
      living(18.5)
      advance(2 * MIN)
      expect(roomWrites(A)).toEqual([])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])

      clear()
      at2(RETURN - 30 * 1000)
      reading(A, { targetTemp: 19 })
      boiler('automatic')
      advance(MIN)

      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      expect(switchStatus()).toEqual({ state: false })
      expect(dateStatus()).toEqual({ value: '' })
      expect(persistedCache.away).toBe(false)
      expect(persistedCache.returnDate).toBe('')
      expect(persistedCache.rooms).toEqual({})
      // The boiler ended by itself at the return minus 6 h
      expect(boilerCommands()).toEqual([])
    })

    it('puts room A back at the return when its reading was missing before', () => {
      goAway()
      showSetback()
      at2(RETURN - 30 * 1000)
      reading(B, { targetTemp: 18.5 })
      advance(MIN)
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(messages().join('\n')).toMatch(/thermostat-a: no fresh reading, not put back/)
      expect(roomWrites(A)).toEqual([])
      expect(switchStatus()).toEqual({ state: false })
    })

    it('keeps the schedule over a restart', () => {
      goAway()
      showSetback()
      clear()

      start()
      // A restart publishes the state again and writes nothing
      expect(switchStatus()).toEqual({ state: true })
      expect(dateStatus()).toEqual({ value: '2026-11-20' })
      expect(roomWrites(A)).toEqual([])

      at2(at('2026-11-17T00:00:30+02:00'))
      reading(A, { targetTemp: 19 })
      reading(B, { targetTemp: 18.5 })
      living(18.5)
      advance(MIN)
      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])

      at2(RETURN + 1000)
      advance(MIN)
      expect(switchStatus()).toEqual({ state: false })
    })

    it('a restart after the return finishes at once', () => {
      goAway()
      at2(RETURN + 5 * HOUR)
      reading(A, { targetTemp: 19 })
      start()
      reading(A, { targetTemp: 19 })
      // The first check at the start has no readings yet; the next one has
      advance(MIN)
      expect(switchStatus()).toEqual({ state: false })
    })
  })

  describe('turning off by hand ("back")', () => {
    it('puts everything back at once and sets the boiler to automatic', () => {
      goAway()
      showSetback()
      boiler('vacation_until')
      clear()
      press(false)

      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(livingWrites()).toEqual([{ setPoint: 21.5 }])
      expect(boilerCommands()).toEqual([{ mode: 'automatic' }])
      expect(switchStatus()).toEqual({ state: false })
      expect(dateStatus()).toEqual({ value: '' })
      expect(messages()).toHaveLength(1)
      expect(messages()[0]).toMatch(/^Back/)
    })

    it('also ends vacation_14d', () => {
      goAway(null)
      boiler('vacation_14d')
      press(false)
      expect(boilerCommands()).toEqual([{ mode: 'automatic' }])
    })

    it('keeps a boiler mode that someone set by hand', () => {
      goAway()
      boiler('manual_on')
      press(false)
      expect(boilerCommands()).toEqual([])
      expect(messages()[0]).toMatch(/boiler: kept manual_on/)
    })

    it('does not touch the boiler when it is automatic already', () => {
      goAway()
      boiler('automatic')
      press(false)
      expect(boilerCommands()).toEqual([])
    })

    it('does nothing when it was off', () => {
      house()
      press(false)
      expect(roomWrites(A)).toEqual([])
      expect(boilerCommands()).toEqual([])
      expect(messages()).toEqual([])
      expect(switchStatus()).toEqual({ state: false })
    })

    it('keeps a value that was changed by hand, and says so', () => {
      goAway()
      reading(A, { targetTemp: 20 })
      reading(B, { targetTemp: 18.5 })
      living(19)
      clear()
      press(false)

      expect(roomWrites(A)).toEqual([])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(livingWrites()).toEqual([])
      expect(messages()[0]).toMatch(/thermostat-a: kept 20/)
      expect(messages()[0]).toMatch(/living room: kept 19/)
    })

    it('does not write a room that is back at the home value already', () => {
      goAway()
      showSetback()
      reading(A, { targetTemp: 22 })
      clear()
      press(false)
      expect(roomWrites(A)).toEqual([])
    })

    it('reports a room that has no fresh reading', () => {
      goAway()
      showSetback()
      at2(Date.now() + 11 * MIN)
      clear()
      press(false)
      expect(roomWrites(A)).toEqual([])
      expect(messages()[0]).toMatch(/thermostat-a: no fresh reading, not put back/)
      expect(persistedCache.away).toBe(false)
    })
  })

  describe('checking the writes', () => {
    it('writes again after 3 minutes without the new value, at most 3 times, then reports', () => {
      house()
      press(true)
      expect(roomWrites(A)).toHaveLength(1)

      advance(2 * MIN)
      expect(roomWrites(A)).toHaveLength(1)
      advance(MIN)
      expect(roomWrites(A)).toHaveLength(2)
      advance(3 * MIN)
      expect(roomWrites(A)).toHaveLength(3)
      clear()
      advance(3 * MIN)
      expect(roomWrites(A)).toEqual([])
      advance(30 * MIN)
      expect(roomWrites(A)).toEqual([])
      expect(messages()).toHaveLength(1)
      expect(messages()[0]).toMatch(/thermostat-a: 19 not confirmed after 3 writes/)
      expect(persistedCache.pending).toEqual([])
    })

    it('stops when the reading shows the value', () => {
      house()
      press(true)
      reading(A, { targetTemp: 19 })
      reading(B, { targetTemp: 18.5 })
      living(18.5)
      advance(20 * MIN)
      expect(roomWrites(A)).toHaveLength(1)
      expect(roomWrites(B)).toHaveLength(1)
      expect(livingWrites()).toHaveLength(1)
    })

    it('does not enforce the value after the checks: a later hand change is kept', () => {
      goAway()
      showSetback()
      reading(A, { targetTemp: 20.5 })
      advance(30 * MIN)
      expect(roomWrites(A)).toEqual([])
    })

    it('checks the living room too', () => {
      house()
      press(true)
      advance(3 * MIN)
      expect(livingWrites()).toHaveLength(2)
    })

    it('checks the written home value after the return', () => {
      goAway()
      showSetback()
      press(false)
      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      clear()
      advance(3 * MIN)
      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
    })

    it('continues the checks after a restart', () => {
      house()
      press(true)
      start()
      advance(3 * MIN)
      expect(roomWrites(A)).toHaveLength(2)
    })
  })

  describe('review fixes', () => {
    it('back before the setback is confirmed: no more setback writes, the home value is written', () => {
      house()
      press(true)
      clear()
      press(false)

      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(livingWrites()).toEqual([{ setPoint: 21.5 }])
      clear()
      advance(10 * MIN)
      // Only the home value is checked and written again
      expect(roomWrites(A).every((w) => w.targetTemp === 22)).toBe(true)
      expect(roomWrites(B).every((w) => w.targetTemp === 21.5)).toBe(true)
      expect(livingWrites().every((w) => w.setPoint === 21.5)).toBe(true)
    })

    it('a dropped entry loses its pending setback write', () => {
      house()
      press(true)
      reading(A, { targetTemp: 20.5 })
      clear()
      press(false)
      expect(persistedCache.pending.filter((p) => p.topic === A)).toEqual([])
      advance(10 * MIN)
      expect(roomWrites(A)).toEqual([])

    })

    it('an unconfirmed setback and no fresh reading: the home value is written, the setback is not', () => {
      house()
      press(true)
      at2(Date.now() + 11 * MIN)
      clear()
      press(false)
      expect(roomWrites(A)).toEqual([{ targetTemp: 22 }])
      advance(10 * MIN)
      expect(roomWrites(A).filter((w) => w.targetTemp === 19)).toEqual([])
    })

    it('a hand change keeps its entry out of the pending list', () => {
      house()
      press(true)
      at2(Date.now() + MIN)
      reading(A, { targetTemp: 20.5 })
      clear()
      press(false)
      expect(roomWrites(A)).toEqual([])
      expect(persistedCache.pending.filter((p) => p.topic === A)).toEqual([])
    })

    it('says "back to automatic" when the boiler ended by itself', () => {
      goAway()
      boiler('automatic')
      press(false)
      expect(messages()[0]).toMatch(/boiler: back to automatic/)
      expect(messages()[0]).not.toMatch(/kept/)
    })

    it('does not put a room back that is not in heating mode now', () => {
      goAway()
      showSetback()
      reading(A, { mode: 'cooling', targetTemp: 19 })
      clear()
      press(false)
      expect(roomWrites(A)).toEqual([])
      expect(roomWrites(B)).toEqual([{ targetTemp: 21.5 }])
      expect(messages()[0]).toMatch(/thermostat-a: mode is cooling/)
    })

    it('keeps a hand change made inside the 3 minutes of checking', () => {
      house()
      press(true)
      reading(A, { targetTemp: 20.5 })
      clear()
      advance(3 * MIN)
      expect(roomWrites(A)).toEqual([])
      expect(messages().join('\n')).toMatch(/thermostat-a: changed by hand to 20.5/)
      expect(persistedCache.pending.filter((p) => p.topic === A)).toEqual([])
    })

    it('still writes again when the reading shows the value from before the write', () => {
      house()
      press(true)
      reading(A, { targetTemp: 22 })
      advance(3 * MIN)
      expect(roomWrites(A)).toHaveLength(2)
    })
  })

  describe('when disabled', () => {
    it('does not send messages or move the schedule', () => {
      goAway()
      showSetback()
      enabled = false
      at2(RETURN + HOUR)
      advance(5 * MIN)

      expect(persistedCache.away).toBe(true)
      expect(messages()).toEqual([])
    })
  })

  describe('payloads', () => {
    it('ignores a switch command without a state', () => {
      house()
      deliver(TOPICS.switchSetTopic, { state: 'on' })
      deliver(TOPICS.switchSetTopic, {})
      expect(persistedCache.away).toBe(false)
    })

    it('ignores a return date without a text', () => {
      setDate('2026-11-20')
      deliver(TOPICS.returnDateSetTopic, { value: 5 })
      expect(persistedCache.returnDate).toBe('2026-11-20')
    })

    it('refuses to start with a stale return date', () => {
      persistedCache.returnDate = '2026-11-01'
      house()
      press(true)
      expect(persistedCache.away).toBe(false)
      expect(switchStatus()).toEqual({ state: false })
      expect(messages()[0]).toMatch(/not started/)
    })
  })
})
