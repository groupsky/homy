const {afterEach, beforeEach, describe, expect, it, jest} = require('@jest/globals')

const BAC = '/modbus/test/thermostat'
const READING = `${BAC}/reading`
const WRITE = `${BAC}/write`
const CONTACT = '/modbus/test/contacts/reading'
const weekDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Local time, so the clock checks do not depend on the time zone of the test run
const WEDNESDAY = new Date(2026, 9, 14, 15, 0, 0).getTime()
const MONDAY = new Date(2026, 9, 12, 15, 0, 0).getTime()
const WANTED = {power: 'on', mode: 'heating', fanSetting: 'auto', targetTemp: 21.5}
// What the unit loads at a restart: the values last set on its panel
const LOADED = {power: 'on', mode: 'cooling', fanSetting: 'auto', targetTemp: 20}
const CLOCK_RESET = {weekDay: 'mon', hours: 0, minutes: 0}

describe('bac002-restore-state bot', () => {
  let mqtt
  let subscribers
  let persistedCache
  let httpPost

  const startBot = (config = {}) => {
    // A fresh module, so the shared message batch starts empty in every test
    const createBot = require('./bac002-restore-state')
    const bot = createBot('test-thermostat', {
      bacTopic: BAC,
      switches: [{topic: CONTACT, isOpen: ({open}) => open}],
      httpPost,
      ...config,
    })
    persistedCache = persistedCache ?? structuredClone(bot.persistedCache.default)
    return bot.start({mqtt, persistedCache})
  }

  // A reading at `at` with the unit's clock right, unless `values` sets it
  const reading = (at, values = WANTED) => {
    const time = new Date(at)
    subscribers[READING]({
      weekDay: weekDays[time.getDay()],
      hours: time.getHours(),
      minutes: time.getMinutes(),
      currentTemp: 20,
      lock: 'unlock',
      ...values,
      _tz: at,
    })
  }
  // Readings every 8 s, as the reader polls, from `from` for `ms`
  const readings = (from, ms, values) => {
    for (let at = from; at < from + ms; at += 8000) reading(at, values)
    return from + ms
  }
  const contact = (open) => subscribers[CONTACT]({open})
  const writes = () => mqtt.publish.mock.calls.filter(([topic]) => topic === WRITE).map(([, payload]) => payload)

  beforeEach(() => {
    jest.useFakeTimers({now: WEDNESDAY})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    subscribers = {}
    mqtt = {
      subscribe: jest.fn((topic, callback) => { subscribers[topic] = callback }),
      publish: jest.fn(),
    }
    persistedCache = undefined
    httpPost = jest.fn().mockResolvedValue({ok: true})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('detects a restart and writes back only the values that differ, after the reload', () => {
    it.each([
      ['a silence over 20 s', WEDNESDAY, (at) => reading(at + 60000, LOADED), 60000],
      ['the clock at Monday 00:xx', WEDNESDAY, (at) => reading(at, {...LOADED, ...CLOCK_RESET}), 0],
      ['the clock at 00:xx on a Monday', MONDAY, (at) => reading(at, {...LOADED, ...CLOCK_RESET}), 0],
      ['only the week day wrong', WEDNESDAY, (at) => reading(at, {...LOADED, weekDay: 'fri'}), 0],
    ])('%s', async (_, start, restart, gap) => {
      await startBot()
      contact(false)
      const at = readings(start, 120000)

      restart(at)
      // The unit reloads its saved values for about 24 s
      readings(at + gap + 8000, 16000, LOADED)
      expect(writes()).toEqual([])

      reading(at + gap + 32000, LOADED)
      expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])

      readings(at + gap + 40000, 60000, LOADED)
      expect(writes()).toHaveLength(1)
    })
  })

  it('does not see a restart in normal readings', async () => {
    await startBot()
    contact(false)
    readings(WEDNESDAY, 10 * 60000)

    expect(writes()).toEqual([])
  })

  it('does not store the values loaded at a restart as wanted', async () => {
    await startBot()
    contact(false)
    let at = readings(WEDNESDAY, 120000)

    // First restart: the write is lost, so the unit keeps the loaded values
    at = readings(at + 60000, 40000, LOADED)
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])

    // Second restart: the bot still wants the values from before
    readings(at + 60000, 40000, LOADED)
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}, {mode: 'heating', targetTemp: 21.5}])
  })

  it('keeps a panel change made after the restart', async () => {
    await startBot()
    contact(false)
    let at = readings(WEDNESDAY, 120000)
    at = readings(at + 60000, 40000, LOADED)
    at = readings(at, 60000, WANTED)

    // A person sets 23 °C on the panel; the next restart loads 20 °C again
    at = readings(at, 60000, {...WANTED, targetTemp: 23})
    readings(at + 60000, 40000, LOADED)

    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}, {mode: 'heating', targetTemp: 23}])
  })

  it('writes nothing when it has no stored state', async () => {
    await startBot()
    contact(false)
    reading(WEDNESDAY, {...LOADED, ...CLOCK_RESET})
    readings(WEDNESDAY + 8000, 60000, LOADED)

    expect(writes()).toEqual([])
  })

  describe('the stored state after an automations restart', () => {
    const runAndRestart = async (downMs) => {
      await startBot()
      contact(false)
      const at = readings(WEDNESDAY, 120000)
      // What the state manager saves to disk and loads at the next start
      persistedCache = JSON.parse(JSON.stringify(persistedCache))
      jest.setSystemTime(at + downMs)
      await startBot()
      contact(false)
      reading(at + downMs, {...LOADED, ...CLOCK_RESET})
      readings(at + downMs + 8000, 40000, LOADED)
    }

    it('is used when it is recent', async () => {
      await runAndRestart(60 * 60000)

      expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
    })

    it('is not used when it is older than 24 h', async () => {
      await runAndRestart(25 * 60 * 60000)

      expect(writes()).toEqual([])
    })
  })

  describe('power', () => {
    const restartWithPowerOff = (at) => readings(at + 60000, 40000, {...LOADED, power: 'off'})

    it('is written back when every contact is closed', async () => {
      await startBot()
      contact(false)
      restartWithPowerOff(readings(WEDNESDAY, 120000))

      expect(writes()).toEqual([{power: 'on', mode: 'heating', targetTemp: 21.5}])
    })

    it('is not written while a contact is open', async () => {
      await startBot()
      contact(false)
      const at = readings(WEDNESDAY, 120000)
      contact(true)
      restartWithPowerOff(at)

      expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
    })

    it('is not written while the contacts have no fresh data', async () => {
      await startBot()
      restartWithPowerOff(readings(WEDNESDAY, 120000))

      expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
    })

    it('is not stored when the contact bot switched it off', async () => {
      await startBot()
      contact(false)
      let at = readings(WEDNESDAY, 120000)
      contact(true)
      at = readings(at, 60000, {...WANTED, power: 'off'})
      contact(false)
      restartWithPowerOff(at)

      expect(writes()).toEqual([{power: 'on', mode: 'heating', targetTemp: 21.5}])
    })
  })

  it('config.js has one for each thermostat contact bot, with the same contacts', () => {
    const {bots} = require('../../../config/automations/config.js')
    const toggles = Object.values(bots).filter(({type}) => type === 'bac002-toggle-power')
    const restores = Object.values(bots).filter(({type}) => type === 'bac002-restore-state')

    expect(toggles.length).toBeGreaterThan(0)
    expect(restores.map(({bacTopic, switches}) => ({bacTopic, switches})))
      .toEqual(toggles.map(({bacTopic, switches}) => ({bacTopic, switches})))
  })

  it('sends one message that lists what it put back', async () => {
    await startBot()
    contact(false)
    readings(readings(WEDNESDAY, 120000) + 60000, 40000, LOADED)

    await jest.advanceTimersByTimeAsync(60000)
    expect(httpPost).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(httpPost.mock.calls[0][1])).toContain('test-thermostat: mode heating, targetTemp 21.5')
  })
})
