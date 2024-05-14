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
            timeouts: {unlock: 1000},
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
            timeouts: {unlock: 1000},
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
            timeouts: {unlock: 1000},
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
            timeouts: {unlock: 1000},
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
            timeouts: {unlock: 1000},
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
            timeouts: {unlock: 1000},
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
            timeouts: {unlock: 1000},
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
})

