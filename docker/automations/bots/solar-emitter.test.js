const { afterEach, beforeEach, describe, expect, it, jest, test } = require('@jest/globals')
const SunCalc = require('suncalc')
const solarEmitter = require('./solar-emitter')

describe('solar-emitter bot', () => {
  let mqtt
  let bot
  let mqttSubscriptions

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z')) // Midday in summer

    mqttSubscriptions = {}
    mqtt = {
      publish: jest.fn(),
      subscribe: (topic, callback) => {
        mqttSubscriptions[topic] = callback
      }
    }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Z2M device integration (ZBMINIR2)', () => {
    const config = {
      statusTopic: 'z2m/house1/P5-night-ext-lights',
      commandTopic: 'z2m/house1/P5-night-ext-lights/set',
      stateParser: (payload) => payload.state === 'ON',
      commandTemplate: (state) => ({ state: state ? 'ON' : 'OFF' }),
      lat: 42.1354,
      lon: 24.7453,
      solarTimeStates: {
        sunset: true,
        sunrise: false
      },
      verbose: false
    }

    beforeEach(() => {
      bot = solarEmitter('nightExternalLightsZ2M', config)
      bot.start({ mqtt })
    })

    test('should parse Z2M ON state correctly', () => {
      const z2mPayload = { state: 'ON', linkquality: 120 }
      const parsed = config.stateParser(z2mPayload)
      expect(parsed).toBe(true)
    })

    test('should parse Z2M OFF state correctly', () => {
      const z2mPayload = { state: 'OFF', linkquality: 120 }
      const parsed = config.stateParser(z2mPayload)
      expect(parsed).toBe(false)
    })

    test('should format command for turning ON', () => {
      const command = config.commandTemplate(true)
      expect(command).toEqual({ state: 'ON' })
    })

    test('should format command for turning OFF', () => {
      const command = config.commandTemplate(false)
      expect(command).toEqual({ state: 'OFF' })
    })

    test('should subscribe to Z2M status topic', () => {
      expect(mqttSubscriptions['z2m/house1/P5-night-ext-lights']).toBeDefined()
    })

    test('should update state when receiving Z2M status messages', () => {
      // Simulate state changes
      mqttSubscriptions['z2m/house1/P5-night-ext-lights']({ state: 'ON', linkquality: 120 })
      mqttSubscriptions['z2m/house1/P5-night-ext-lights']({ state: 'OFF', linkquality: 115 })

      // Subscription callback should handle both messages without errors
      expect(mqttSubscriptions['z2m/house1/P5-night-ext-lights']).toBeDefined()
    })

    test('should handle Z2M messages with additional properties', () => {
      // Z2M sends many extra properties
      const fullZ2mPayload = {
        state: 'ON',
        linkquality: 120,
        update: { state: 'idle' },
        update_available: false
      }

      const parsed = config.stateParser(fullZ2mPayload)
      expect(parsed).toBe(true)
    })
  })

  describe('Modbus relay integration (existing)', () => {
    const config = {
      statusTopic: '/modbus/dry-switches/relays00-15/reading',
      commandTopic: '/modbus/dry-switches/relays00-15/write',
      stateParser: ({ outputs }) => Boolean(outputs & (1 << 15)),
      commandTemplate: (state) => ({ out15: state }),
      lat: 42.1354,
      lon: 24.7453,
      solarTimeStates: {
        sunset: true,
        sunrise: false
      },
      verbose: false
    }

    beforeEach(() => {
      bot = solarEmitter('nightExternalLights', config)
      bot.start({ mqtt })
    })

    test('should parse Modbus relay state correctly when bit 15 is ON', () => {
      const modbusPayload = { outputs: 0x8000 } // Bit 15 set
      const parsed = config.stateParser(modbusPayload)
      expect(parsed).toBe(true)
    })

    test('should parse Modbus relay state correctly when bit 15 is OFF', () => {
      const modbusPayload = { outputs: 0x7FFF } // Bit 15 clear
      const parsed = config.stateParser(modbusPayload)
      expect(parsed).toBe(false)
    })

    test('should format command for Modbus relay', () => {
      const command = config.commandTemplate(true)
      expect(command).toEqual({ out15: true })
    })
  })

  describe('solar events that do not occur', () => {
    // SunCalc reports an event that never happens on a given day as `null`
    // (suncalc 2.x) or as an invalid Date (suncalc 1.x). getTimes is stubbed
    // here so both shapes are pinned whichever version is installed.
    const config = {
      statusTopic: 'z2m/house1/P5-night-ext-lights',
      commandTopic: 'z2m/house1/P5-night-ext-lights/set',
      stateParser: (payload) => payload.state === 'ON',
      commandTemplate: (state) => ({ state: state ? 'ON' : 'OFF' }),
      lat: 78.2232,
      lon: 15.6469,
      solarTimeStates: {
        sunset: true,
        sunrise: false,
        night: true,
        nightEnd: false
      },
      verbose: false
    }

    const day = (date) => date.toISOString().slice(0, 10)
    const at = (date, time) => new Date(`${day(date)}T${time}Z`)

    let getTimes

    beforeEach(() => {
      jest.setSystemTime(new Date('2026-06-15T12:00:00Z'))
      getTimes = jest.spyOn(SunCalc, 'getTimes')
    })

    afterEach(() => {
      getTimes.mockRestore()
    })

    // The sun rises and sets, but it never gets dark enough for night to start
    // or end - so two of the four configured events are missing every day.
    const noNight = (missing) => (date) => ({
      sunrise: at(date, '03:00:00'),
      sunset: at(date, '23:00:00'),
      night: missing,
      nightEnd: missing
    })

    describe.each([
      ['null, as suncalc 2.x reports it', null],
      ['an invalid Date, as suncalc 1.x reports it', new Date(NaN)]
    ])('when a missing event is %s', (_label, missing) => {
      beforeEach(() => {
        getTimes.mockImplementation(noNight(missing))
        bot = solarEmitter('nightExternalLightsPolar', config)
        bot.start({ mqtt })
      })

      test('should take the state from the events that do occur', () => {
        // Sunrise at 03:00 is the most recent event, so the lights belong off.
        mqttSubscriptions['z2m/house1/P5-night-ext-lights']({ state: 'ON' })

        expect(mqtt.publish).toHaveBeenCalledWith(
          'z2m/house1/P5-night-ext-lights/set',
          { state: 'OFF' }
        )
      })

      test('should schedule the next check on the next event that occurs', () => {
        // Sunset today at 23:00, eleven hours out. Three getTimes calls so far
        // - yesterday, today, tomorrow.
        expect(getTimes).toHaveBeenCalledTimes(3)

        jest.advanceTimersByTime(11 * 60 * 60 * 1000 - 1000)
        expect(getTimes).toHaveBeenCalledTimes(3)

        jest.advanceTimersByTime(2000)
        expect(getTimes).toHaveBeenCalledTimes(6)
      })
    })

    describe('when no configured event occurs at all', () => {
      beforeEach(() => {
        // Polar day: the sun neither rises nor sets.
        getTimes.mockImplementation(() => ({
          sunrise: null,
          sunset: null,
          night: null,
          nightEnd: null
        }))
        bot = solarEmitter('nightExternalLightsMidnightSun', config)
        bot.start({ mqtt })
      })

      test('should not command the device, having no state to want', () => {
        mqttSubscriptions['z2m/house1/P5-night-ext-lights']({ state: 'OFF' })

        expect(mqtt.publish).not.toHaveBeenCalled()
      })

      test('should look again in a day rather than spin', () => {
        expect(getTimes).toHaveBeenCalledTimes(3)

        jest.advanceTimersByTime(23 * 60 * 60 * 1000)
        expect(getTimes).toHaveBeenCalledTimes(3)

        jest.advanceTimersByTime(2 * 60 * 60 * 1000)
        expect(getTimes).toHaveBeenCalledTimes(6)
      })
    })

    test('should start against the real suncalc at a polar latitude', () => {
      getTimes.mockRestore()
      bot = solarEmitter('nightExternalLightsMidnightSun', config)

      expect(() => bot.start({ mqtt })).not.toThrow()
    })
  })
})
