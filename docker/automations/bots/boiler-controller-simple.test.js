const { describe, test, expect, jest } = require('@jest/globals');

describe('boiler-controller basic functionality', () => {
    test('should create controller and call initial functions', () => {
        const boilerController = require('./boiler-controller')

        expect(typeof boilerController).toBe('function')

        const instance = boilerController('test', {
            temperatureTopTopic: 'temp/top',
            boilerRelayTopic: 'relay/boiler',
            controlModeTopic: 'control/mode/set'
        })

        expect(instance).toHaveProperty('start')
        expect(typeof instance.start).toBe('function')
        expect(instance).toHaveProperty('persistedCache')
        expect(instance.persistedCache).toHaveProperty('version')
        expect(instance.persistedCache).toHaveProperty('default')
    })

    test('should subscribe to temperature topics', () => {
        const boilerController = require('./boiler-controller')('test', {
            temperatureTopTopic: 'temp/top',
            temperatureBottomTopic: 'temp/bottom',
            boilerRelayTopic: 'relay/boiler',
            controlModeTopic: 'control/mode/set'
        })

        const mqtt = {
            subscribe: jest.fn(),
            publish: jest.fn()
        }
        const persistedCache = {
            controlMode: 'automatic',
            manualOverrideExpires: null
        }

        boilerController.start({ mqtt, persistedCache })

        expect(mqtt.subscribe).toHaveBeenCalledWith('temp/top', expect.any(Function))
        expect(mqtt.subscribe).toHaveBeenCalledWith('temp/bottom', expect.any(Function))
        expect(mqtt.subscribe).toHaveBeenCalledWith('control/mode/set', expect.any(Function))
    })

    test('should make initial decision on startup', () => {
        const boilerController = require('./boiler-controller')('test', {
            temperatureTopTopic: 'temp/top',
            boilerRelayTopic: 'relay/boiler',
            controlModeTopic: 'control/mode/set'
        })

        const mqtt = {
            subscribe: jest.fn(),
            publish: jest.fn()
        }
        const persistedCache = {
            controlMode: 'automatic',
            manualOverrideExpires: null
        }

        boilerController.start({ mqtt, persistedCache })

        // Should publish initial decision, status, and control mode status
        // Actually publishes: 1) relay command, 2) automation status, 3) control mode status, 4) control mode status again from updateHeaterState
        expect(mqtt.publish).toHaveBeenCalledTimes(4)
        expect(mqtt.publish).toHaveBeenCalledWith('relay/boiler', expect.any(Object))
        expect(mqtt.publish).toHaveBeenCalledWith('homy/automation/test/status', expect.any(Object))
        expect(mqtt.publish).toHaveBeenCalledWith('control/mode/status', expect.any(Object))
    })

    test('should handle three-state control mode selection', () => {
        const boilerController = require('./boiler-controller')('test', {
            temperatureTopTopic: 'temp/top',
            boilerRelayTopic: 'relay/boiler',
            controlModeTopic: 'control/mode/set'
        })

        const mqttSubscriptions = {}
        const publishedMessages = []

        const mqtt = {
            subscribe: jest.fn((topic, callback) => {
                mqttSubscriptions[topic] = callback
            }),
            publish: jest.fn((topic, payload) => {
                publishedMessages.push({ topic, payload })
            })
        }

        const persistedCache = {
            controlMode: 'automatic',
            manualOverrideExpires: null
        }

        boilerController.start({ mqtt, persistedCache })

        // Test manual_on mode
        mqttSubscriptions['control/mode/set']('manual_on')

        expect(persistedCache.controlMode).toBe('manual_on')
        expect(persistedCache.manualOverrideExpires).toBeGreaterThan(Date.now())

        // Test manual_off mode
        mqttSubscriptions['control/mode/set']('manual_off')

        expect(persistedCache.controlMode).toBe('manual_off')
        expect(persistedCache.manualOverrideExpires).toBeGreaterThan(Date.now())

        // Test automatic mode
        mqttSubscriptions['control/mode/set']('automatic')

        expect(persistedCache.controlMode).toBe('automatic')
        expect(persistedCache.manualOverrideExpires).toBeNull()

        // Verify control mode status is published (fallback uses /set -> /status replacement)
        const controlModePublishes = publishedMessages.filter(msg =>
            msg.topic === 'control/mode/status')
        expect(controlModePublishes.length).toBeGreaterThan(0)

        const lastStatus = controlModePublishes[controlModePublishes.length - 1].payload
        expect(lastStatus.mode).toBe('automatic')
    })

    test('should handle vacation modes with smart timing', () => {
        const boilerController = require('./boiler-controller')('test', {
            temperatureTopTopic: 'temp/top',
            boilerRelayTopic: 'relay/boiler',
            controlModeTopic: 'control/mode/set'
        })

        const mqttSubscriptions = {}
        const publishedMessages = []

        const mqtt = {
            subscribe: jest.fn((topic, callback) => {
                mqttSubscriptions[topic] = callback
            }),
            publish: jest.fn((topic, payload) => {
                publishedMessages.push({ topic, payload })
            })
        }

        const persistedCache = {
            controlMode: 'automatic',
            manualOverrideExpires: null
        }

        boilerController.start({ mqtt, persistedCache })

        // Test vacation_3d mode
        mqttSubscriptions['control/mode/set']('vacation_3d')

        expect(persistedCache.controlMode).toBe('vacation_3d')
        expect(persistedCache.manualOverrideExpires).toBeGreaterThan(Date.now())

        // Verify 3-day vacation is 2.25 days (66 hours = 237.6M milliseconds)
        const expected3dayDuration = (3 * 24 - 6) * 60 * 60 * 1000 // 66 hours in ms
        const actualDuration = persistedCache.manualOverrideExpires - Date.now()
        expect(actualDuration).toBeGreaterThan(expected3dayDuration - 1000) // Allow 1s tolerance
        expect(actualDuration).toBeLessThan(expected3dayDuration + 1000)

        // Test vacation_7d mode
        mqttSubscriptions['control/mode/set']('vacation_7d')

        expect(persistedCache.controlMode).toBe('vacation_7d')

        // Verify 7-day vacation is 6.75 days (162 hours)
        const expected7dayDuration = (7 * 24 - 6) * 60 * 60 * 1000
        const actual7dayDuration = persistedCache.manualOverrideExpires - Date.now()
        expect(actual7dayDuration).toBeGreaterThan(expected7dayDuration - 1000)
        expect(actual7dayDuration).toBeLessThan(expected7dayDuration + 1000)

        // Test that vacation mode disables heater by checking boiler commands
        const boilerCommands = publishedMessages.filter(msg => msg.topic === 'relay/boiler')
        const lastBoilerCommand = boilerCommands[boilerCommands.length - 1]
        const boilerState = lastBoilerCommand.payload
        expect(boilerState.state).toBe(false) // Heater should be OFF during vacation
        expect(boilerState.reason).toMatch(/vacation_7d/)
    })
})