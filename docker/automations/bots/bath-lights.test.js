const {beforeEach, describe, jest, test, expect} = require('@jest/globals')
const BathLights = require('./bath-lights')

const mqttSubscriptions = {}

const subscribe = (topic, cb) => {
    mqttSubscriptions[topic] = cb
}

const publish = (topic, payload) => {
    mqttSubscriptions[topic](payload)
}

beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
})


describe('bath-lights', () => {
    test('should turn on lights when locked', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command'},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // lock
        publish('lock/status', {state: true})

        // should turn on the lights
        expect(mockPublish).toHaveBeenCalledWith('lights/command', {state: true})
    })

    test('should turn on lights when turned off while locked', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})
        publish('lock/status', {state: true})

        // turn off the lights
        mockPublish.mockClear()
        publish('lights/status', {state: false})

        // should turn on the lights
        expect(mockPublish).toHaveBeenCalledWith('lights/command', {state: true})
    })

    test('should not turn on lights when turned off while unlocked', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})
        publish('lock/status', {state: false})

        // turn off the lights
        mockPublish.mockClear()
        publish('lights/status', {state: false})

        // should not turn on the lights
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', {state: true})
    })

    test('should turn off lights with delay when unlocked without door state', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        mockPublish.mockClear()
        publish('lock/status', {state: false})

        // no lights change
        expect(mockPublish).not.toHaveBeenCalled()

        // should turn off the lights after delay
        jest.advanceTimersByTime(1000)
        expect(mockPublish).toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should keep light on when locked after unlocked before timeout and without door state', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        mockPublish.mockClear()
        publish('lock/status', {state: false})
        publish('lock/status', {state: true})
        jest.advanceTimersByTime(1000)

        // no lights change
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should keep lights on when missed lock event during unlock timeout', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        mockPublish.mockClear()
        publish('lock/status', {state: false})
        publish('lock/status', {state: false})
        publish('lock/status', {state: true})
        jest.advanceTimersByTime(1000)

        // no lights change
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should not turn off lights when turned off externally during unlock timeout', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        mockPublish.mockClear()
        publish('lock/status', {state: false})
        publish('lights/status', {state: false})
        jest.advanceTimersByTime(1000)

        // no lights change
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should not turn off lights when turned on externally during unlock timeout', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        mockPublish.mockClear()
        publish('lock/status', {state: false})
        publish('lights/status', {state: false})
        publish('lights/status', {state: true})
        jest.advanceTimersByTime(1000)

        // no lights change
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should turn off lights when door opened after unlock', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            door: {statusTopic: 'door/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        mockPublish.mockClear()
        publish('lock/status', {state: false})
        expect(mockPublish).not.toHaveBeenCalled()
        publish('door/status', {state: true})

        // should turn off the lights
        expect(mockPublish).toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should not turn off lights when door opened after unlock and unlock timeout expired', () => {
        const bathLights = BathLights('test-bath-lights', {
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            door: {statusTopic: 'door/status'},
            timeouts: {unlocked: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('lock/status', {state: true})
        publish('lock/status', {state: false})
        publish('door/status', {state: true})
        mockPublish.mockClear()
        jest.advanceTimersByTime(1000)

        // should not turn off the lights
        expect(mockPublish).not.toHaveBeenCalled()
    })

    test('should turn on lights when door opened after being closed', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('door/status', {state: false})
        mockPublish.mockClear()
        publish('door/status', {state: true})

        // should turn on the lights
        expect(mockPublish).toHaveBeenCalledWith('lights/command', {state: true})
    })

    test('should turn off lights after open timeout', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {opened: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('door/status', {state: false})
        publish('door/status', {state: true})
        mockPublish.mockClear()
        jest.advanceTimersByTime(1000)

        // should turn off the lights
        expect(mockPublish).toHaveBeenCalledWith('lights/command', {state: false})
    })

    test('should not turn off lights after open timeout when already turned off', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {opened: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('door/status', {state: false})
        publish('door/status', {state: true})
        mockPublish.mockClear()
        publish('lights/status', {state: false})
        jest.advanceTimersByTime(1000)

        // should not turn off the lights
        expect(mockPublish).not.toHaveBeenCalled()
    })

    test('should not turn off lights after open timeout when already turned off and double open event', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {opened: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        publish('door/status', {state: false})
        publish('door/status', {state: true})
        publish('door/status', {state: true})
        mockPublish.mockClear()
        publish('lights/status', {state: false})
        jest.advanceTimersByTime(1000)

        // should not turn off the lights
        expect(mockPublish).not.toHaveBeenCalled()
    })

    test.only('should work continuously', () => {
        const state = {}
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {closed: 1*60000, opened: 2*60000, unlocked: 3*60000},
            verbose: true
        })
        const mockPublish = jest.fn().mockImplementation((topic, payload) => {
            console.log('publish', topic, payload)
            expect(topic).toEqual('lights/command')
            state[topic.split('/')[0]] = payload.state
        })
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        /////////////////////////
        // Scenario - close door
        /////////////////////////

        // close door - lights on
        publish('door/status', {state: false})
        expect(state).toEqual({lights: true})

        // wait for 1 minute - lights off
        jest.advanceTimersByTime(60000)
        expect(state).toEqual({lights: false})

        // wait for 1 hour - lights off
        jest.advanceTimersByTime(60*60000)
        expect(state).toEqual({lights: false})

        /////////////////////////
        // Scenario - open door
        /////////////////////////

        // open door - lights on
        publish('door/status', {state: true})
        expect(state).toEqual({lights: true})

        // wait for 1 minute - lights on
        jest.advanceTimersByTime(60000)
        expect(state).toEqual({lights: true})

        // wait for 1 minute - lights off
        jest.advanceTimersByTime(60000)
        expect(state).toEqual({lights: false})

        // wait for 1 hour - lights off
        jest.advanceTimersByTime(60*60000)
        expect(state).toEqual({lights: false})


        //////////////////////////
        // Scenario - close & lock
        //////////////////////////

        // close door - lights on
        publish('door/status', {state: false})
        expect(state).toEqual({lights: true})

        // wait for 1 minute - lights on
        jest.advanceTimersByTime(60000)
        expect(state).toEqual({lights: true})

        // lock door - lights on
        publish('lock/status', {state: true})
        expect(state).toEqual({lights: true})

        // wait for 1 hour - lights on
        jest.advanceTimersByTime(3600000)
        expect(state).toEqual({lights: true})

        //////////////////////////
        // Scenario - unlock & open
        //////////////////////////

        // unlock door - lights on
        publish('lock/status', {state: false})
        expect(state).toEqual({lights: true})

        // wait for 1 minute - lights on
        jest.advanceTimersByTime(60000)
        expect(state).toEqual({lights: true})

        // wait for 1 minute - lights on
        jest.advanceTimersByTime(60000)
        expect(state).toEqual({lights: true})

        // open door - lights off
        publish('door/status', {state: true})
        expect(state).toEqual({lights: false})

        // wait for 1 hour - lights off
        jest.advanceTimersByTime(3600000)
        expect(state).toEqual({lights: false})
    })
})

