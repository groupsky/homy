const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')

// away-mode and bac002-restore-state on the same thermostat and the same
// broker (#1756). After a restart of the thermostat, restore-state must put
// back the setback value while away and the home value after the return.

const BAC = '/modbus/test/thermostat-a'
const READING = `${BAC}/reading`
const WRITE = `${BAC}/write`
const CONTACT = '/modbus/test/contacts/reading'
const weekDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const TOPICS = {
  thermostatTopics: [BAC],
  livingRoomSetTopic: 'test/living/set',
  livingRoomStatusTopic: 'test/living/status',
  boilerSetTopic: 'test/boiler/set',
  boilerStatusTopic: 'test/boiler/status',
  switchSetTopic: 'test/away/set',
  switchStatusTopic: 'test/away/status',
  returnDateSetTopic: 'test/date/set',
  returnDateStatusTopic: 'test/date/status'
}
const START = new Date(2026, 10, 2, 10, 0, 0).getTime()
const HOME = { power: 'on', mode: 'heating', fanSetting: 'auto', targetTemp: 21.5 }
const CLOCK_RESET = { weekDay: 'mon', hours: 0, minutes: 0 }

describe('away-mode with bac002-restore-state on one thermostat', () => {
  let subscribers
  let published
  let thermostat
  let clock

  // A broker that hands every message to every subscriber, at once
  const mqtt = {
    subscribe: (topic, callback) => { (subscribers[topic] ??= []).push(callback) },
    publish: (topic, payload) => {
      published.push({ topic, payload })
      for (const callback of subscribers[topic] ?? []) callback(payload)
    }
  }
  const send = (topic, payload) => mqtt.publish(topic, payload)

  // One reading from the thermostat. `unit` replaces what the unit shows.
  const poll = (unit = {}) => {
    jest.setSystemTime(clock)
    const time = new Date(clock)
    send(READING, {
      weekDay: weekDays[time.getDay()],
      hours: time.getHours(),
      minutes: time.getMinutes(),
      currentTemp: 20,
      lock: 'unlock',
      ...thermostat,
      ...unit,
      _tz: clock
    })
    clock += 8000
  }
  const polls = (ms, unit) => { for (const end = clock + ms; clock < end;) poll(unit) }
  const writes = () => published.filter((m) => m.topic === WRITE).map((m) => m.payload)

  beforeEach(() => {
    jest.useFakeTimers({ now: START })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    subscribers = {}
    published = []
    clock = START
    thermostat = { ...HOME }
    // The unit takes a write to its registers
    mqtt.subscribe(WRITE, (payload) => { thermostat = { ...thermostat, ...payload } })

    const httpPost = jest.fn().mockResolvedValue({ ok: true })
    const restore = require('./bac002-restore-state')('restore', {
      bacTopic: BAC, switches: [{ topic: CONTACT, isOpen: ({ open }) => open }], httpPost
    })
    restore.start({ mqtt, persistedCache: structuredClone(restore.persistedCache.default) })
    send(CONTACT, { open: false })
    const away = require('./away-mode')('away', { ...TOPICS, httpPost })
    away.start({ mqtt, persistedCache: structuredClone(away.persistedCache.default), isEnabled: () => true })

    send(TOPICS.livingRoomStatusTopic, { setPoint: 21.5 })
    send(TOPICS.boilerStatusTopic, { mode: 'automatic' })
    polls(2 * 60 * 1000)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // The unit restarts: its clock starts at Monday 00:00 and it loads the
  // values saved by its own panel, then the reload takes about 24 s
  const restart = (panel) => {
    poll({ ...panel, ...CLOCK_RESET })
    polls(24000, panel)
    expect(writes().slice(before)).toEqual([])
    poll(panel)
  }
  let before

  it('puts back the setback value after a restart while away', () => {
    send(TOPICS.switchSetTopic, { state: true })
    expect(writes()).toEqual([{ targetTemp: 18.5 }])
    polls(60000)
    expect(thermostat.targetTemp).toBe(18.5)

    before = writes().length
    restart(HOME)
    expect(writes().slice(before)).toEqual([{ targetTemp: 18.5 }])
    expect(thermostat.targetTemp).toBe(18.5)
  })

  it('puts back the home value after a restart following the return', () => {
    send(TOPICS.switchSetTopic, { state: true })
    polls(60000)
    send(TOPICS.switchSetTopic, { state: false })
    expect(writes().at(-1)).toEqual({ targetTemp: 21.5 })
    polls(60000)
    expect(thermostat.targetTemp).toBe(21.5)

    // The panel still holds an older value
    before = writes().length
    restart({ ...HOME, targetTemp: 20 })
    expect(writes().slice(before)).toEqual([{ targetTemp: 21.5 }])
    expect(thermostat.targetTemp).toBe(21.5)
  })

  it('keeps the away bot from fighting the restore: no extra writes after the confirmed setback', () => {
    send(TOPICS.switchSetTopic, { state: true })
    polls(10 * 60 * 1000)
    expect(writes()).toEqual([{ targetTemp: 18.5 }])
  })
})
