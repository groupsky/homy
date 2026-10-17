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
      ['a silence of 60 s', WEDNESDAY, (at) => reading(at + 60000, LOADED), 60000],
      // A self-restart on a Monday leaves the week day right; one poll is missed
      ['a silence of 17 s on a Monday', MONDAY, (at) => reading(at + 9000, LOADED), 9000],
      ['the clock at Monday 00:xx', WEDNESDAY, (at) => reading(at, {...LOADED, ...CLOCK_RESET}), 0],
      ['the clock at 00:xx on a Monday', MONDAY, (at) => reading(at, {...LOADED, ...CLOCK_RESET}), 0],
      ['only the week day wrong', WEDNESDAY, (at) => reading(at, {...LOADED, weekDay: 'fri'}), 0],
    ])('%s', async (_, start, restart, gap) => {
      await startBot()
      contact(false)
      const at = readings(start, 120000)

      restart(at)
      // The unit reloads its saved values for about 24 s
      readings(at + gap + 8000, 24000, LOADED)
      expect(writes()).toEqual([])

      reading(at + gap + 32000, LOADED)
      expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])

      // The unit took the write
      readings(at + gap + 40000, 60000, WANTED)
      expect(writes()).toHaveLength(1)
    })
  })

  describe('sees no restart', () => {
    // Readings from `from` for 8 min with the unit's clock `unitClockOffsetMs`
    // off and its week day `weekDay` if set. A person sets 23 °C at the panel
    // at `changeAt`, just after the time a false restart signal would come.
    const panelChangeDuring = (from, changeAt, unitClockOffsetMs, weekDay) => {
      for (let at = from; at < from + 8 * 60000; at += 8000) {
        const clock = new Date(at + unitClockOffsetMs)
        reading(at, {
          ...(at >= changeAt ? {...WANTED, targetTemp: 23} : WANTED),
          weekDay: weekDay ?? weekDays[clock.getDay()],
          hours: clock.getHours(),
          minutes: clock.getMinutes(),
        })
      }
    }

    it('in normal readings', async () => {
      await startBot()
      contact(false)
      readings(WEDNESDAY, 10 * 60000)

      expect(writes()).toEqual([])
    })

    it('at midnight when the unit clock is a minute behind', async () => {
      await startBot()
      contact(false)
      panelChangeDuring(new Date(2026, 9, 13, 23, 57, 0).getTime(), new Date(2026, 9, 14, 0, 0, 10).getTime(), -60000)

      expect(writes()).toEqual([])
    })

    it('on a Monday at 01:00 when the unit clock is a minute behind', async () => {
      await startBot()
      contact(false)
      panelChangeDuring(new Date(2026, 9, 12, 0, 58, 0).getTime(), new Date(2026, 9, 12, 1, 0, 10).getTime(), -60000)

      expect(writes()).toEqual([])
    })

    it('at the end of the midnight skip when the unit week day stays wrong', async () => {
      await startBot()
      contact(false)
      const from = new Date(2026, 9, 13, 23, 50, 0).getTime()
      // The week day was lost earlier and bac002-sync-clock does not fix it
      reading(from, {...WANTED, weekDay: 'fri'})
      readings(from + 8000, 5 * 60000, {...WANTED, weekDay: 'fri'})
      panelChangeDuring(new Date(2026, 9, 13, 23, 56, 0).getTime(), new Date(2026, 9, 14, 0, 2, 10).getTime(), 0, 'fri')

      expect(writes()).toEqual([])
    })

    it('in a reader outage longer than 2 min, during which the panel is used', async () => {
      await startBot()
      contact(false)
      const at = readings(WEDNESDAY, 120000)
      readings(at + 2 * 60 * 60000, 120000, {...WANTED, targetTemp: 23})

      expect(writes()).toEqual([])
    })
  })

  it('drops a waiting write-back when a reader outage over 2 min follows the restart', async () => {
    await startBot()
    contact(false)
    const at = readings(WEDNESDAY, 120000)
    reading(at, {...LOADED, ...CLOCK_RESET})
    // The reader stops for 1 h; a person sets 23 °C at the panel meanwhile
    readings(at + 60 * 60000, 120000, {...LOADED, targetTemp: 23})

    expect(writes()).toEqual([])
  })

  it('sees one restart when the unit clock stays wrong', async () => {
    await startBot()
    contact(false)
    const at = readings(WEDNESDAY, 120000)
    reading(at, {...LOADED, weekDay: 'fri'})
    // bac002-sync-clock does not fix it; the unit takes the write
    readings(at + 8000, 32000, {...LOADED, weekDay: 'fri'})
    readings(at + 40000, 5 * 60000, {...WANTED, weekDay: 'fri'})

    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
  })

  it('does not store the values loaded at a restart as wanted, even when a write is lost', async () => {
    await startBot()
    contact(false)
    let at = readings(WEDNESDAY, 120000)

    // The first write is lost: the unit keeps the loaded values, so it is sent again
    at = readings(at + 60000, 72000, LOADED)
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}, {mode: 'heating', targetTemp: 21.5}])
    at = readings(at, 60000, WANTED)

    // The next restart: the bot still wants the values from before
    readings(at + 60000, 40000, LOADED)
    expect(writes()).toHaveLength(3)
    expect(writes()[2]).toEqual({mode: 'heating', targetTemp: 21.5})
  })

  it('writes again only the fields that still show the loaded value', async () => {
    await startBot()
    contact(false)
    let at = readings(WEDNESDAY, 120000)
    at = readings(at + 60000, 40000, LOADED)
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])

    // The mode write is lost; meanwhile a person sets 23 °C and the fan to low
    readings(at, 5 * 60000, {...LOADED, targetTemp: 23, fanSetting: 'low'})
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}, {mode: 'heating'}])
  })

  it('writes for each of several quick restarts', async () => {
    await startBot()
    contact(false)
    const at = readings(WEDNESDAY, 120000)
    // A clock reset, then two silences of 20 s, each inside the check after
    // the write before. The later restarts also load another fan setting.
    for (const start of [at, at + 52000, at + 104000]) {
      const loaded = start === at ? LOADED : {...LOADED, fanSetting: 'high'}
      reading(start, {...loaded, ...(start === at ? CLOCK_RESET : {})})
      readings(start + 8000, 32000, loaded)
    }
    readings(at + 144000, 5 * 60000, WANTED)

    expect(writes()).toEqual([
      {mode: 'heating', targetTemp: 21.5},
      {mode: 'heating', fanSetting: 'auto', targetTemp: 21.5},
      {mode: 'heating', fanSetting: 'auto', targetTemp: 21.5},
    ])
  })

  describe('a reader outage over 2 min while the unit clock is still wrong from a restart', () => {
    const outage = async (unitClock) => {
      await startBot()
      contact(false)
      const at = readings(WEDNESDAY, 120000)
      reading(at, {...LOADED, ...CLOCK_RESET})
      reading(at + 8000, {...LOADED, ...CLOCK_RESET})
      reading(at + 10 * 60000, {...LOADED, ...unitClock})
      readings(at + 10 * 60000 + 8000, 32000, {...LOADED, ...unitClock})
      readings(at + 10 * 60000 + 40000, 60000, {...WANTED, ...unitClock})
    }

    it('is a restart when the unit restarted in it', async () => {
      await outage({weekDay: 'mon', hours: 0, minutes: 1})

      expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
    })

    it('is not a restart when the unit ran through it', async () => {
      await outage({weekDay: 'mon', hours: 0, minutes: 10})

      expect(writes()).toEqual([])
    })
  })

  it('sees no restart after an overnight reader outage when only the week day is stuck at Monday', async () => {
    await startBot()
    contact(false)
    const evening = new Date(2026, 9, 13, 20, 0, 0).getTime()
    readings(evening, 120000, {...WANTED, weekDay: 'mon'})
    // The reader is down until 08:00; a person sets 23 °C at the panel
    readings(evening + 12 * 60 * 60000, 120000, {...WANTED, targetTemp: 23, weekDay: 'mon'})

    expect(writes()).toEqual([])
  })

  it('checks the age of the stored state at the first of several restarts', async () => {
    persistedCache = {wanted: {...WANTED}, seenAt: WEDNESDAY - 24 * 60 * 60000 + 30000}
    await startBot()
    contact(false)
    // A clock reset, then silences of 20 s; the last signal is past the 24 h
    reading(WEDNESDAY, {...LOADED, ...CLOCK_RESET})
    for (let at = WEDNESDAY + 20000; at <= WEDNESDAY + 60000; at += 20000) reading(at, LOADED)
    readings(WEDNESDAY + 68000, 40000, LOADED)

    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
  })

  it('writes power at the second check when a contact closed after the first', async () => {
    await startBot()
    contact(false)
    let at = readings(WEDNESDAY, 120000)
    contact(true)
    at = readings(at + 60000, 40000, {...LOADED, power: 'off'})
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])

    contact(false)
    readings(at, 60000, {...WANTED, power: 'off'})
    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}, {power: 'on'}])
  })

  it('does not store values the driver does not accept', async () => {
    await startBot()
    contact(false)
    let at = readings(WEDNESDAY, 120000)
    at = readings(at, 60000, {...WANTED, fanSetting: 4, targetTemp: 0})
    readings(at + 60000, 40000, LOADED)

    expect(writes()).toEqual([{mode: 'heating', targetTemp: 21.5}])
  })

  it('writes at most twice after a restart', async () => {
    await startBot()
    contact(false)
    readings(readings(WEDNESDAY, 120000) + 60000, 5 * 60000, LOADED)

    expect(writes()).toHaveLength(2)
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
      // The reading right after the contact closes still shows the contact bot's "off"
      reading(at, {...WANTED, power: 'off'})
      restartWithPowerOff(at + 8000)

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
