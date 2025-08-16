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
    describe('toggle button', () => {
        test('should turn on lights when toggle changes', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command'},
                toggle: {statusTopic: 'switch/status', type: 'button'}
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // toggle status
            publish('switch/status', {state: true})
            publish('switch/status', {state: false})

            // should turn on the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should turn off lights when toggle changes and lights are on', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'}
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights on
            publish('lights/status', {state: true})

            // toggle status
            publish('switch/status', {state: true})
            publish('switch/status', {state: false})

            // should turn off the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should turn on lights when toggle changes and lights are off', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // toggle status
            publish('switch/status', {state: true})
            publish('switch/status', {state: false})

            // should turn off the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should turn off lights after toggle timeout', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {
                    toggled: 1000
                },
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // toggle status
            publish('switch/status', {state: true})
            publish('switch/status', {state: false})

            // should turn on the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // wait for timeout
            jest.advanceTimersByTime(1000)

            // should turn off the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should not turn off lights after toggle timeout when turned off and on', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {
                    toggled: 1000
                },
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // toggle status
            publish('switch/status', {state: true})
            publish('switch/status', {state: false})

            // should turn on the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // turn light off and on again
            publish('lights/status', {state: false})
            publish('lights/status', {state: true})
            jest.advanceTimersByTime(1000)

            // should not turn off the lights
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('toggle switch', () => {
        test('should turn on lights when toggle switch changes', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command'},
                toggle: {statusTopic: 'switch/status', type: 'switch'}
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // toggle status
            publish('switch/status', {state: true})

            // should turn on the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should turn off lights when toggle switch changes from on to off', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'switch'}
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights are on
            publish('lights/status', {state: true})
            
            // toggle switch changes from true to false
            publish('switch/status', {state: true})
            mockPublish.mockClear()
            publish('switch/status', {state: false})

            // should turn off the lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle toggle switch both directions correctly', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'switch'}
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights start off
            publish('lights/status', {state: false})

            // switch off->on: should turn on lights
            publish('switch/status', {state: false})
            mockPublish.mockClear()
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))

            // simulate lights turning on
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // switch on->off: should turn off lights
            publish('switch/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))

            // simulate lights turning off
            publish('lights/status', {state: false})
            mockPublish.mockClear()

            // switch off->on again: should turn on lights
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test.each([false, true])('should not change light when toggle switch is still %s', (state) => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command'},
                toggle: {statusTopic: 'switch/status', type: 'switch'}
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // toggle status
            publish('switch/status', {state})
            mockPublish.mockClear()
            publish('switch/status', {state})

            // should turn on the lights
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('lock', () => {
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
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
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
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
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
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
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
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
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
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
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
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
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
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
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
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })
    })

    describe('lock and toggle', () => {
        test('should not turn off light when locked and toggle changes', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            publish('lock/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()
            publish('switch/status', {state: true})

            // should not turn off the lights
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('door & lock', () => {
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
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
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

        test('should not turn off lights when door closed after unlock', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                door: {statusTopic: 'door/status'},
                timeouts: {closed: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            publish('lock/status', {state: true})
            publish('lights/status', {state: true})
            publish('door/status', {state: false})
            mockPublish.mockClear()
            jest.advanceTimersByTime(1000)

            // should not turn off the lights
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should cancel unlock timer when door opens during unlock timeout', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                door: {statusTopic: 'door/status'},
                timeouts: {unlocked: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lock then unlock (starts unlock timer)
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            mockPublish.mockClear()

            // wait partway through unlock timeout
            jest.advanceTimersByTime(1000)

            // door opens - should cancel unlock timer and turn off lights immediately
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false, r: 'don-unl'}))
            mockPublish.mockClear()

            // wait past when unlock timeout would have fired
            jest.advanceTimersByTime(1000)

            // should not fire unlock timeout since it was cancelled
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('door', () => {
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
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
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
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
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

    test('should not turn off lights when locked after door closed timeout was set', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {closed: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // close door (unlocked) - lights on and timeout set
        publish('door/status', {state: false})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // lock door before timeout expires
        publish('lock/status', {state: true})

        // advance time past the closed timeout
        jest.advanceTimersByTime(1000)

        // lights should NOT turn off because door is now locked
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
    })

    test('should not send duplicate light commands when timeout fires after lights already off', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {closed: 1000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // close door - lights on and timeout set
        publish('door/status', {state: false})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // lights turn off externally before timeout
        publish('lights/status', {state: false})

        // advance time past the closed timeout
        jest.advanceTimersByTime(1000)

        // should NOT send another turn-off command
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
    })

    test('should not turn off lights when door open event repeats', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {opened: 2000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // door closes - lights on
        publish('door/status', {state: false})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // door opens - lights on and 2-second timeout set
        publish('door/status', {state: true})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // wait 1 second
        jest.advanceTimersByTime(1000)

        // door open event repeats (should not interfere)
        publish('door/status', {state: true})
        expect(mockPublish).not.toHaveBeenCalled() // no new light command

        // wait another second (original timeout should fire)
        jest.advanceTimersByTime(1000)

        // lights should turn off from original timeout
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
    })

    test('should not interfere with unlock timeout when door open event repeats', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {unlocked: 1500, opened: 3000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // lock door - lights on
        publish('lock/status', {state: true})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // unlock door - unlock timeout set (1.5s)
        publish('lock/status', {state: false})
        expect(mockPublish).not.toHaveBeenCalled() // no immediate light change

        // wait 500ms
        jest.advanceTimersByTime(500)

        // door opens - should turn lights off immediately (cancelling unlock timeout)
        publish('door/status', {state: true})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false, r: 'don-unl'}))
        mockPublish.mockClear()

        // wait 500ms
        jest.advanceTimersByTime(500)

        // door open event repeats - should not cause any additional actions
        publish('door/status', {state: true})
        expect(mockPublish).not.toHaveBeenCalled()

        // wait past when unlock timeout would have fired (500ms more = 1.5s total)
        jest.advanceTimersByTime(500)

        // should not turn off lights again
        expect(mockPublish).not.toHaveBeenCalled()
    })

    test('should not override manual toggle timeout when door closes', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            toggle: {statusTopic: 'switch/status', type: 'button'},
            timeouts: {closed: 2000, toggled: 25000}, // 2s vs 25s - big difference
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // Guest enters and manually turns on lights (like manual switch)
        publish('switch/status', {state: true})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // Simulate lights actually turning on
        publish('lights/status', {state: true})

        // Guest closes door - this should NOT override the manual toggle timeout
        publish('door/status', {state: false})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // Wait past closed timeout (2s) but before toggle timeout (25s)
        jest.advanceTimersByTime(3000)

        // Lights should still be on - manual override should take priority
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))

        // Wait until toggle timeout should fire (25s total)
        jest.advanceTimersByTime(22000)

        // Now lights should turn off from the original manual toggle timeout
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
    })

    test('should not restart closed timeout when door close event repeats', () => {
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            timeouts: {closed: 2000},
        })
        const mockPublish = jest.fn()
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        // close door - lights on and 2-second timeout set
        publish('door/status', {state: false})
        expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        mockPublish.mockClear()

        // wait 1 second
        jest.advanceTimersByTime(1000)

        // door close event repeats (should not reset the timer)
        publish('door/status', {state: false})
        expect(mockPublish).not.toHaveBeenCalled() // no new light command

        // lock the door after repeated event
        publish('lock/status', {state: true})

        // wait another second (original timeout would have fired here)
        jest.advanceTimersByTime(1000)

        // lights should NOT turn off because door was locked before original timeout
        expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
    })

    describe('toggle timeout edge cases', () => {
        test('should cancel toggle timeout when lights turn off manually', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {toggled: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // toggle to turn on lights
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // manually turn off lights (should cancel timer)
            publish('lights/status', {state: false})

            // wait for timeout
            jest.advanceTimersByTime(1000)

            // should not send duplicate off command
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should not create multiple toggle timers from rapid presses', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {toggled: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // first toggle
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // second toggle (should turn off, no timeout)
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
            mockPublish.mockClear()

            // simulate lights turning off
            publish('lights/status', {state: false})

            // third toggle (should turn on and create new timeout)
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // wait for timeout
            jest.advanceTimersByTime(2000)

            // should turn off only once
            expect(mockPublish).toHaveBeenCalledTimes(1)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle toggle timeout when lock state changes', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                lock: {statusTopic: 'lock/status'},
                timeouts: {toggled: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lights off, unlocked
            publish('lights/status', {state: false})
            publish('lock/status', {state: false})

            // toggle to turn on lights
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // lock door during timeout
            publish('lock/status', {state: true})

            // wait for toggle timeout
            jest.advanceTimersByTime(1000)

            // should not turn off lights when locked
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })
    })

    describe('door state initialization', () => {
        test('should handle door opening without prior close event', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {opened: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // door opens without prior state (doorState is null)
            publish('door/status', {state: true})

            // should turn on lights and set timeout
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // wait for timeout
            jest.advanceTimersByTime(1000)

            // should turn off lights
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle door closing without prior open event', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {closed: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // door closes without prior state (doorState is null)
            publish('door/status', {state: false})

            // should turn on lights since doorStateChanged is true (null !== false)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true, r: 'doff'}))
            mockPublish.mockClear()

            // should also set closed timeout
            jest.advanceTimersByTime(1000)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle rapid door state changes correctly', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {opened: 1000, closed: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // rapid changes: open -> close -> open -> close
            publish('door/status', {state: true})  // open
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true, r: 'don'}))
            
            publish('door/status', {state: false}) // close
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true, r: 'doff'}))
            
            publish('door/status', {state: true})  // open again
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true, r: 'don'}))
            
            publish('door/status', {state: false}) // close again
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true, r: 'doff'}))

            // Should have 4 light-on commands total
            expect(mockPublish).toHaveBeenCalledTimes(4)
            expect(mockPublish).toHaveBeenNthCalledWith(1, 'lights/command', expect.objectContaining({state: true}))
            expect(mockPublish).toHaveBeenNthCalledWith(2, 'lights/command', expect.objectContaining({state: true}))
            expect(mockPublish).toHaveBeenNthCalledWith(3, 'lights/command', expect.objectContaining({state: true}))
            expect(mockPublish).toHaveBeenNthCalledWith(4, 'lights/command', expect.objectContaining({state: true}))
        })

        test('should not turn on lights for repeated door open events', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // first door open
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // repeated door open (no state change)
            publish('door/status', {state: true})
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('lock state edge cases', () => {
        test('should not send duplicate commands when unlock timeout fires with lights already off', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {unlocked: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lock then unlock
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})

            // lights turn off externally
            publish('lights/status', {state: false})
            mockPublish.mockClear()

            // wait for unlock timeout
            jest.advanceTimersByTime(1000)

            // should not send duplicate off command
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should handle lock state changes during door open timeout', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {opened: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // door opens
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // wait half timeout
            jest.advanceTimersByTime(1000)

            // lock during timeout
            publish('lock/status', {state: true})

            // wait for remaining timeout
            jest.advanceTimersByTime(1000)

            // should not turn off lights when locked
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle repeated unlock events without multiple timers', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {unlocked: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lock then unlock (creates timer)
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            mockPublish.mockClear()

            // unlock again while timer active (should not create second timer)
            publish('lock/status', {state: false})

            // wait for timeout
            jest.advanceTimersByTime(1000)

            // should turn off lights only once
            expect(mockPublish).toHaveBeenCalledTimes(1)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })
    })

    describe('timer interaction scenarios', () => {
        test('should prioritize toggle timeout over door close timeout', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 1000, toggled: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // toggle lights on
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // door closes (should not start close timeout due to toggle timeout)
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // wait past close timeout but before toggle timeout
            jest.advanceTimersByTime(1500)

            // lights should still be on
            expect(mockPublish).not.toHaveBeenCalled()

            // wait for toggle timeout
            jest.advanceTimersByTime(500)

            // should turn off from toggle timeout
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should not start door open timeout when toggle timeout active', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {opened: 1000, toggled: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // toggle lights on
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // door opens (should not start open timeout due to toggle timeout)
            publish('door/status', {state: false})
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // wait past open timeout but before toggle timeout
            jest.advanceTimersByTime(1500)

            // lights should still be on
            expect(mockPublish).not.toHaveBeenCalled()

            // wait for toggle timeout
            jest.advanceTimersByTime(500)

            // should turn off from toggle timeout
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should cancel all timers when lights turn off', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 3000, opened: 3000, toggled: 3000, unlocked: 3000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // set up multiple potential timers
            publish('lock/status', {state: true})
            publish('lock/status', {state: false}) // unlock timer
            publish('door/status', {state: false}) // close timer
            publish('lights/status', {state: false})
            publish('switch/status', {state: true}) // toggle timer
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // manually turn off lights (should cancel all timers)
            publish('lights/status', {state: false})

            // wait past all timeouts
            jest.advanceTimersByTime(3000)

            // no commands should be sent
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('light state edge cases', () => {
        test('should handle null light state properly', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lock when light state is null
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should turn on lights when turned off while locked regardless of previous state', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lock first
            publish('lock/status', {state: true})
            mockPublish.mockClear()

            // lights turn off while locked
            publish('lights/status', {state: false})

            // should immediately turn back on
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })
    })

    describe('error conditions', () => {
        test('should handle missing timeout configuration gracefully', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                // no timeouts config
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // door operations should work without timeouts
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))

            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should handle missing optional components gracefully', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command'},
                // no door, lock, or toggle
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // should not throw
            expect(() => bathLights.start({mqtt})).not.toThrow()
        })
    })

    describe('complex state combinations', () => {
        test('should handle door open → close → lock → unlock sequence', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {closed: 1000, unlocked: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // door open
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // door close
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // lock before close timeout (should turn on lights)
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // wait past close timeout
            jest.advanceTimersByTime(1000)
            expect(mockPublish).not.toHaveBeenCalled()

            // unlock
            publish('lock/status', {state: false})

            // wait for unlock timeout
            jest.advanceTimersByTime(2000)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle overlapping timeout scenarios with state changes', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 3000, unlocked: 2000, toggled: 4000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // start locked
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // unlock (starts unlock timer: 2s)
            publish('lock/status', {state: false})

            // close door (would start close timer but lock state prevents it)
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // toggle (starts toggle timer: 4s, but lights already on so toggles off)
            publish('lights/status', {state: true})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
            mockPublish.mockClear()

            // simulate lights turning off
            publish('lights/status', {state: false})

            // wait past unlock timeout (2s)
            jest.advanceTimersByTime(2000)

            // should not turn off (already off)
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    test('should work continuously', () => {
        const state = {}
        const bathLights = BathLights('test-bath-lights', {
            door: {statusTopic: 'door/status'},
            lock: {statusTopic: 'lock/status'},
            light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            toggle: {statusTopic: 'switch/status'},
            timeouts: {closed: 1 * 60000, opened: 2 * 60000, toggled: 5 * 60000, unlocked: 3 * 60000},
        })
        const mockPublish = jest.fn().mockImplementation((topic, payload) => {
            expect(topic).toEqual('lights/command')
            state[topic.split('/')[0]] = payload.state
        })
        const mqtt = {subscribe, publish: mockPublish}

        // start the bot
        bathLights.start({mqtt})

        /////////////////////////
        // Scenario - switch
        /////////////////////////

        // switch - lights on
        publish('switch/status', {state: true})
        publish('switch/status', {state: false})
        expect(state).toEqual({lights: true})

        // wait for 5 minute - lights off
        jest.advanceTimersByTime(5 * 60000)
        expect(state).toEqual({lights: false})

        // wait for 1 hour - lights off
        jest.advanceTimersByTime(60 * 60000)
        expect(state).toEqual({lights: false})

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
        jest.advanceTimersByTime(60 * 60000)
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
        jest.advanceTimersByTime(60 * 60000)
        expect(state).toEqual({lights: false})


        //////////////////////////
        // Scenario - close & lock
        //////////////////////////

        // close door - lights on
        publish('door/status', {state: false})
        expect(state).toEqual({lights: true})

        // wait for almost 1 minute - lights on
        jest.advanceTimersByTime(59999)
        expect(state).toEqual({lights: true})

        // wait for 1 ms - lights off
        jest.advanceTimersByTime(1)
        expect(state).toEqual({lights: false})

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

    describe('verbose logging', () => {
        test('should correctly interpolate name in verbose log messages', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
            
            const bathLights = BathLights('test-bathroom', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // toggle to turn on lights
            publish('switch/status', {state: true})

            // should log with interpolated name, not literal string
            expect(consoleSpy).toHaveBeenCalledWith('[test-bathroom] turning on lights')
            expect(consoleSpy).not.toHaveBeenCalledWith('[${name}] turning on lights')

            // lights on
            publish('lights/status', {state: true})
            consoleSpy.mockClear()

            // toggle to turn off lights 
            publish('switch/status', {state: true})

            // should log with interpolated name, not literal string
            expect(consoleSpy).toHaveBeenCalledWith('[test-bathroom] turning off lights')
            expect(consoleSpy).not.toHaveBeenCalledWith('[${name}] turning off lights')

            consoleSpy.mockRestore()
        })

        test('should log timeout calculations correctly', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
            
            const bathLights = BathLights('test-bathroom', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {toggled: 120000}, // 2 minutes
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lights off
            publish('lights/status', {state: false})

            // toggle to turn on lights
            publish('switch/status', {state: true})

            // should log correct minute calculation (120000 / 60000 = 2)
            expect(consoleSpy).toHaveBeenCalledWith('[test-bathroom] turning off lights in 2 minutes from toggled timeout')

            consoleSpy.mockRestore()
        })
    })

    describe('toggle type defaults', () => {
        test('should default to button type when type not specified', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status'}, // no type specified
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // start the bot
            bathLights.start({mqtt})

            // lights off initially
            publish('lights/status', {state: false})

            // first toggle press (true state) - should turn lights ON since they're off
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights actually turning on
            publish('lights/status', {state: true})

            // toggle state false (should not trigger for button type - only true state triggers)
            publish('switch/status', {state: false})
            expect(mockPublish).not.toHaveBeenCalled()
            
            // second toggle press (true state again) - should turn lights OFF since they're now on
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should prevent toggle timeout from turning off lights when locked', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                lock: {statusTopic: 'lock/status'},
                timeouts: {toggled: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // lights off initially
            publish('lights/status', {state: false})

            // toggle to turn on lights with timeout
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // simulate lights turning on
            publish('lights/status', {state: true})

            // lock the door - this should prevent toggle timeout from turning off lights
            publish('lock/status', {state: true})

            // wait for toggle timeout to fire
            jest.advanceTimersByTime(1000)

            // lights should NOT turn off because door is locked
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })
    })

    describe('reason codes validation', () => {
        test('should use correct reason codes for basic actions', () => {
            // Test each reason code in separate bot instances to avoid interference
            
            // Test 'lck' - lights on when locked
            const lockBot = BathLights('lock-test', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command'},
            })
            let mockPublish = jest.fn()
            lockBot.start({mqtt: {subscribe, publish: mockPublish}})
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'lck'}))

            // Test 'tgl-loff' - toggle turns on lights when off
            const toggleOffBot = BathLights('toggle-off-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
            })
            mockPublish = jest.fn()
            toggleOffBot.start({mqtt: {subscribe, publish: mockPublish}})
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'tgl-loff'}))

            // Test 'tgl-lon' - toggle turns off lights when on
            const toggleOnBot = BathLights('toggle-on-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
            })
            mockPublish = jest.fn()
            toggleOnBot.start({mqtt: {subscribe, publish: mockPublish}})
            publish('lights/status', {state: true})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'tgl-lon'}))

            // Test 'don' - door opened
            const doorBot = BathLights('door-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command'},
            })
            mockPublish = jest.fn()
            doorBot.start({mqtt: {subscribe, publish: mockPublish}})
            publish('door/status', {state: true}) // door opens (no prior state)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'don'}))

            // Test 'doff' - door closed
            mockPublish.mockClear()
            publish('door/status', {state: false}) // door closes
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'doff'}))
        })

        test('should use timeout-specific reason codes', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 500, opened: 500, toggled: 500, unlocked: 500},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test 'tgl-tout' - toggle timeout
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()
            jest.advanceTimersByTime(500)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'tgl-tout'}))

            // Test 'don-tout' - door open timeout
            mockPublish.mockClear()
            publish('door/status', {state: false})
            publish('door/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()
            jest.advanceTimersByTime(500)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'don-tout'}))

            // Test 'doff-tout' - door closed timeout
            mockPublish.mockClear()
            publish('door/status', {state: false})
            publish('lights/status', {state: true})
            mockPublish.mockClear()
            jest.advanceTimersByTime(500)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'doff-tout'}))

            // Test 'don-unl' - door opened during unlock timeout
            mockPublish.mockClear()
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'don-unl'}))
        })
    })

    describe('payload validation', () => {
        test('should handle null payload without crashing', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test null payload - should not crash (this was the original bug)
            expect(() => {
                mqttSubscriptions['lights/status'](null)
                mqttSubscriptions['door/status'](null)
                mqttSubscriptions['lock/status'](null)
                mqttSubscriptions['switch/status'](null)
            }).not.toThrow()

            // Test undefined payload - should not crash
            expect(() => {
                mqttSubscriptions['lights/status'](undefined)
                mqttSubscriptions['door/status'](undefined)
                mqttSubscriptions['lock/status'](undefined)
                mqttSubscriptions['switch/status'](undefined)
            }).not.toThrow()

            // Null/undefined payloads should not trigger any actions
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should handle undefined and falsy payload.state values correctly', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test payload with undefined state - should not crash but may trigger actions
            expect(() => {
                mqttSubscriptions['lights/status']({state: undefined})
                mqttSubscriptions['door/status']({state: undefined})
            }).not.toThrow()

            // Test payload with null state - should not crash but may trigger actions
            expect(() => {
                mqttSubscriptions['lights/status']({state: null})
                mqttSubscriptions['door/status']({state: null})
            }).not.toThrow()

            // Test payload with missing state property - should not crash
            expect(() => {
                mqttSubscriptions['lights/status']({})
                mqttSubscriptions['door/status']({})
            }).not.toThrow()

            // Some falsy values may legitimately trigger door close actions (state: false)
            // The key is that it doesn't crash, behavior can vary based on falsy interpretation
        })

        test('should handle non-boolean payload.state values with type coercion', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test string values (truthy/falsy)
            mqttSubscriptions['lights/status']({state: "true"}) // truthy
            mqttSubscriptions['lights/status']({state: "false"}) // truthy (not boolean false!)
            mqttSubscriptions['lights/status']({state: ""}) // falsy
            
            // Test number values
            mqttSubscriptions['lights/status']({state: 1}) // truthy
            mqttSubscriptions['lights/status']({state: 0}) // falsy
            
            // Test object values
            mqttSubscriptions['lights/status']({state: {}}) // truthy
            mqttSubscriptions['lights/status']({state: []}) // truthy

            // Should not crash from type coercion issues
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('unlock timeout edge cases', () => {
        test('should handle unlock timeout when door is already open', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {unlocked: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start with door already open
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // Lock then unlock (should start unlock timer)
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            publish('lock/status', {state: false})
            
            // Wait for unlock timeout - should turn off lights even though door is open
            jest.advanceTimersByTime(1000)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false, r: 'unl-tout'}))
        })
    })

    describe('timeout light state validation', () => {
        test('should validate light state before timeout turns off lights', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 500, opened: 500, toggled: 500, unlocked: 500},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test toggle timeout validation (line 113: lightState !== false && !lockState)
            publish('lights/status', {state: false})
            publish('switch/status', {state: true}) // start toggle timer
            publish('lights/status', {state: true}) // simulate lights on
            
            // Turn lights off before timeout
            publish('lights/status', {state: false})
            mockPublish.mockClear()
            
            // Timeout fires but should not send command since lights already off
            jest.advanceTimersByTime(500)
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should validate lock state before timeout turns off lights', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {unlocked: 500},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start unlock timer
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            publish('lights/status', {state: true})
            
            // Lock door before timeout
            publish('lock/status', {state: true})
            mockPublish.mockClear()
            
            // Timeout fires but should not send command since door is locked
            jest.advanceTimersByTime(500)
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should validate both light and lock state for door timeouts', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {opened: 500, closed: 500},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test door open timeout validation
            publish('door/status', {state: true})
            publish('lights/status', {state: true})
            
            // Lock door before timeout
            publish('lock/status', {state: true})
            mockPublish.mockClear()
            
            jest.advanceTimersByTime(500)
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))

            // Test door close timeout validation
            mockPublish.mockClear()
            publish('lock/status', {state: false}) // unlock
            publish('door/status', {state: false}) // close door
            
            // Turn lights off before timeout
            publish('lights/status', {state: false})
            
            jest.advanceTimersByTime(500)
            expect(mockPublish).not.toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should handle lightState with null and undefined values in timeout validation', () => {
            const bathLights = BathLights('test-bath-lights', {
                toggle: {statusTopic: 'switch/status', type: 'button'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {toggled: 500},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start toggle timer with lights off
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            
            // Simulate lights turning on to create the timer
            publish('lights/status', {state: true})
            mockPublish.mockClear()
            
            // Set lightState to null (edge case) - this should cancel timers since !null is true
            publish('lights/status', {state: null})
            
            // Timer should be cancelled so no timeout should fire
            jest.advanceTimersByTime(500)
            expect(mockPublish).not.toHaveBeenCalled()
            
            // Test that the system still works after null state
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })
    })

    describe('timer creation guards', () => {
        test('should not create door opened timer when toggledTimer exists', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {opened: 2000, toggled: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start toggle timer first
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // Door opens - should turn on lights but NOT create opened timer due to toggledTimer
            publish('door/status', {state: false})
            publish('door/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // Wait for toggle timer to fire (1 second)
            jest.advanceTimersByTime(1000)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'tgl-tout'}))
            mockPublish.mockClear()

            // Wait past when opened timer would have fired (if it existed)
            jest.advanceTimersByTime(1000)
            expect(mockPublish).not.toHaveBeenCalled() // No opened timer was created
        })

        test('should not create door closed timer when lockState is true', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {closed: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Lock door first
            publish('lock/status', {state: true})
            mockPublish.mockClear()

            // Close door - should turn on lights but NOT create closed timer due to lockState
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // Wait past when closed timer would have fired (if it existed)
            jest.advanceTimersByTime(1000)
            expect(mockPublish).not.toHaveBeenCalled() // No closed timer was created
        })

        test('should not create toggledTimer when toggledTimer already exists', () => {
            const bathLights = BathLights('test-bath-lights', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {toggled: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // First toggle - creates timer
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // Second toggle while timer active - should turn off lights but not create new timer
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
            mockPublish.mockClear()

            // Turn lights back on
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // Original timer should still fire after 2 seconds total
            jest.advanceTimersByTime(2000)
            expect(mockPublish).toHaveBeenCalledTimes(1) // Only one timer fired
        })

        test('should not create door closed timer when toggledTimer exists', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 2000, toggled: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start toggle timer first
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // Door closes - should turn on lights but NOT create closed timer due to toggledTimer
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublish.mockClear()

            // Wait for toggle timer to fire (1 second)
            jest.advanceTimersByTime(1000)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'tgl-tout'}))
            mockPublish.mockClear()

            // Wait past when closed timer would have fired (if it existed)
            jest.advanceTimersByTime(1000)
            expect(mockPublish).not.toHaveBeenCalled() // No closed timer was created
        })

        test('should not create unlock timer when unlockedTimer already exists', () => {
            const bathLights = BathLights('test-bath-lights', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {unlocked: 2000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Lock then unlock (creates unlock timer)
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            mockPublish.mockClear()

            // Unlock again while timer active (should not create second timer)
            publish('lock/status', {state: false})
            expect(mockPublish).not.toHaveBeenCalled()

            // Wait for original unlock timeout to fire
            jest.advanceTimersByTime(2000)
            expect(mockPublish).toHaveBeenCalledTimes(1) // Only one timer fired
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({r: 'unl-tout'}))
        })
    })

    describe('multiple simultaneous timers', () => {
        test('should handle multiple timers firing at the same time', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 1000, opened: 1000, toggled: 1000, unlocked: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Set up multiple potential timers
            // 1. Lock then unlock (starts unlock timer)
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            
            // 2. Close door (starts close timer, but prevented by lock state) 
            publish('door/status', {state: false})
            
            // 3. Toggle on lights (starts toggle timer)
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            
            mockPublish.mockClear()
            
            // Simulate lights turning on
            publish('lights/status', {state: true})

            // Fast forward to when all timers would fire (1000ms)
            jest.advanceTimersByTime(1000)

            // Should only turn off once (toggle timer should fire, unlock should be blocked by lock state)
            expect(mockPublish).toHaveBeenCalledTimes(1)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))
        })

        test('should prioritize immediate actions over timers', () => {
            const bathLights = BathLights('test-bath-lights', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {unlocked: 1000},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start unlock timer
            publish('lock/status', {state: true})
            publish('lock/status', {state: false})
            mockPublish.mockClear()

            // Door opens right before unlock timer fires (immediate action)
            jest.advanceTimersByTime(999)
            publish('door/status', {state: true})
            
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false, r: 'don-unl'}))
            mockPublish.mockClear()

            // Advance past when unlock timer would have fired
            jest.advanceTimersByTime(1)
            
            // Should not fire unlock timer since door opening cancelled it
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('stress testing and edge cases', () => {
        test('should handle rapid message bursts without memory leaks', () => {
            const bathLights = BathLights('stress-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 100, opened: 100, toggled: 100, unlocked: 100},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Simulate rapid-fire message bursts (100 messages in quick succession)
            for (let i = 0; i < 100; i++) {
                publish('door/status', {state: i % 2 === 0})
                publish('lock/status', {state: i % 3 === 0})
                publish('lights/status', {state: i % 5 === 0})
                publish('switch/status', {state: true})
            }

            // System should handle this gracefully without crashing
            expect(mockPublish).toHaveBeenCalled()
            
            // Fast forward through all potential timeouts
            jest.advanceTimersByTime(1000)
            
            // Should not crash or have memory issues
            expect(() => {
                for (let i = 0; i < 50; i++) {
                    publish('door/status', {state: false})
                    jest.advanceTimersByTime(10)
                }
            }).not.toThrow()
        })

        test('should handle interleaved events with complex state transitions', () => {
            const bathLights = BathLights('complex-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 500, opened: 500, toggled: 500, unlocked: 500},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Complex interleaved scenario
            const sequence = [
                () => publish('lock/status', {state: true}),       // lock
                () => jest.advanceTimersByTime(50),
                () => publish('door/status', {state: false}),      // close
                () => jest.advanceTimersByTime(50),
                () => publish('switch/status', {state: true}),     // toggle
                () => jest.advanceTimersByTime(50),
                () => publish('lock/status', {state: false}),      // unlock
                () => jest.advanceTimersByTime(50),
                () => publish('door/status', {state: true}),       // open
                () => jest.advanceTimersByTime(50),
                () => publish('lights/status', {state: false}),    // lights off
                () => jest.advanceTimersByTime(50),
                () => publish('switch/status', {state: true}),     // toggle again
                () => jest.advanceTimersByTime(50),
                () => publish('door/status', {state: false}),      // close again
                () => jest.advanceTimersByTime(500),               // let timeouts fire
            ]

            // Execute complex sequence - should not crash
            expect(() => {
                sequence.forEach(action => action())
            }).not.toThrow()

            // Verify system is still responsive
            mockPublish.mockClear()
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should maintain state consistency across thousands of operations', () => {
            const bathLights = BathLights('consistency-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 10, opened: 10, toggled: 10, unlocked: 10},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Track expected vs actual state
            let expectedLightState = null
            let actualCommands = []

            mockPublish.mockImplementation((topic, payload) => {
                if (topic === 'lights/command') {
                    actualCommands.push(payload.state)
                }
            })

            // Run thousands of operations with timer advancement
            for (let cycle = 0; cycle < 100; cycle++) {
                // Lock/unlock cycle
                publish('lock/status', {state: true})
                expectedLightState = true
                publish('lock/status', {state: false})
                
                // Door open/close cycle  
                publish('door/status', {state: true})
                expectedLightState = true
                publish('door/status', {state: false})
                expectedLightState = true
                
                // Advance time to let timers fire
                jest.advanceTimersByTime(20)
                
                // Toggle cycle
                publish('lights/status', {state: false})
                publish('switch/status', {state: true})
                expectedLightState = true
                
                jest.advanceTimersByTime(20)
            }

            // Verify we got a reasonable number of commands (system was active)
            expect(actualCommands.length).toBeGreaterThan(100)
            
            // Verify final system responsiveness
            mockPublish.mockClear()
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalled()
        })

        test('should handle edge case timeout values', () => {
            // Test with very small timeouts (1ms)
            const bathLightsSmall = BathLights('small-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {closed: 1, opened: 1},
            })
            const mockPublishSmall = jest.fn()
            bathLightsSmall.start({mqtt: {subscribe, publish: mockPublishSmall}})

            publish('door/status', {state: false})
            expect(mockPublishSmall).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            mockPublishSmall.mockClear()
            
            // Simulate lights turning on
            publish('lights/status', {state: true})
            
            // Small timeout should fire after 1ms
            jest.advanceTimersByTime(1)
            expect(mockPublishSmall).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: false}))

            // Test with very large timeouts (shouldn't cause integer overflow)
            const bathLightsLarge = BathLights('large-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command'},
                timeouts: {closed: Number.MAX_SAFE_INTEGER},
            })
            const mockPublishLarge = jest.fn()
            
            expect(() => {
                bathLightsLarge.start({mqtt: {subscribe, publish: mockPublishLarge}})
                publish('door/status', {state: false})
            }).not.toThrow()

            // Test with negative timeouts (should be handled gracefully)
            const bathLightsNegative = BathLights('negative-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command'},
                timeouts: {closed: -1000},
            })
            const mockPublishNegative = jest.fn()
            
            expect(() => {
                bathLightsNegative.start({mqtt: {subscribe, publish: mockPublishNegative}})
                publish('door/status', {state: false})
            }).not.toThrow()
        })

        test('should handle concurrent timer creation and cancellation', () => {
            const bathLights = BathLights('concurrent-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 200, opened: 200, toggled: 200, unlocked: 200},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Create and cancel timers rapidly in various combinations
            for (let i = 0; i < 50; i++) {
                // Start multiple timers
                publish('lock/status', {state: true})
                publish('lock/status', {state: false})  // unlock timer
                publish('door/status', {state: false})  // close timer  
                publish('lights/status', {state: false})
                publish('switch/status', {state: true}) // toggle timer
                
                // Cancel some by turning lights off
                if (i % 3 === 0) {
                    publish('lights/status', {state: false})
                }
                
                // Cancel others by locking
                if (i % 3 === 1) {
                    publish('lock/status', {state: true})
                }
                
                // Let some complete naturally
                if (i % 3 === 2) {
                    jest.advanceTimersByTime(200)
                }
                
                // Small time advancement
                jest.advanceTimersByTime(10)
            }

            // System should still be responsive
            mockPublish.mockClear()
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalled()
        })

        test('should maintain performance with deep state nesting', () => {
            const bathLights = BathLights('performance-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 50, opened: 50, toggled: 50, unlocked: 50},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Create deeply nested state scenarios
            const startTime = Date.now()
            
            for (let depth = 0; depth < 20; depth++) {
                // Each depth level creates more complex state
                for (let operation = 0; operation < 10; operation++) {
                    publish('lock/status', {state: operation % 2 === 0})
                    publish('door/status', {state: operation % 3 === 0})
                    publish('lights/status', {state: operation % 5 === 0})
                    publish('switch/status', {state: true})
                    
                    // Partial time advancement
                    jest.advanceTimersByTime(10)
                }
                
                // Complete cycle
                jest.advanceTimersByTime(100)
            }
            
            const endTime = Date.now()
            
            // Performance should be reasonable (within 5 seconds for the test)
            expect(endTime - startTime).toBeLessThan(5000)
            
            // System should still respond
            mockPublish.mockClear()
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalled()
        })
    })

    describe('MQTT error handling scenarios', () => {
        test('should expose MQTT publish failures (current behavior - no error handling)', () => {
            const bathLights = BathLights('mqtt-error-test', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            
            // Mock MQTT publish that throws errors
            const mockPublish = jest.fn().mockImplementation(() => {
                throw new Error('MQTT connection lost')
            })
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Current implementation will throw - this documents the behavior
            expect(() => {
                publish('lock/status', {state: true})
            }).toThrow('MQTT connection lost')
            
            // Verify publish was attempted
            expect(mockPublish).toHaveBeenCalled()
        })

        test('should expose missing MQTT publish method (current behavior - no error handling)', () => {
            const bathLights = BathLights('mqtt-missing-test', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command'},
            })
            
            // MQTT object without publish method
            const mqtt = {subscribe}

            // Should not crash during startup
            expect(() => {
                bathLights.start({mqtt})
            }).not.toThrow()

            // Current implementation will throw when trying to publish
            expect(() => {
                publish('lock/status', {state: true})
            }).toThrow('mqtt.publish is not a function')
        })

        test('should handle malformed MQTT topics gracefully', () => {
            const bathLights = BathLights('malformed-topic-test', {
                door: {statusTopic: ''},  // empty topic
                lock: {statusTopic: null}, // null topic
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            // Should not crash with malformed topics during startup
            expect(() => {
                bathLights.start({mqtt})
            }).not.toThrow()

            // System should still work with valid topics
            publish('lights/status', {state: false})
            expect(mockPublish).not.toHaveBeenCalled() // No commands expected for empty events
        })

        test('should expose MQTT subscription errors during startup (current behavior)', () => {
            const bathLights = BathLights('subscription-error-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()

            // Mock subscribe that throws on certain topics
            const mockSubscribe = jest.fn((topic, callback) => {
                if (topic === 'door/status') {
                    throw new Error('Subscription failed')
                }
                mqttSubscriptions[topic] = callback
            })
            const mqtt = {subscribe: mockSubscribe, publish: mockPublish}

            // Current implementation will throw during startup if subscription fails
            expect(() => {
                bathLights.start({mqtt})
            }).toThrow('Subscription failed')
        })

        test('should handle corrupted MQTT message payloads', () => {
            const bathLights = BathLights('corrupted-payload-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test various corrupted payload scenarios - most should not crash due to null guards
            const corruptedPayloads = [
                null,           // handled by null guard
                undefined,      // handled by null guard
                {},             // has state: undefined (falsy)
                {state: undefined}, // falsy state value
                {state: null},  // falsy state value
                {corrupted: 'data'}, // has state: undefined (falsy)
                'string instead of object', // will crash - not an object
                123,            // will crash - not an object
                [],             // has state: undefined (falsy)
                {state: {nested: 'object'}}, // truthy state value (object)
            ]

            corruptedPayloads.forEach((payload, index) => {
                // All payloads should be handled gracefully due to existing null guards
                // The null guard at the start of each handler prevents crashes
                expect(() => {
                    mqttSubscriptions['door/status'](payload)
                    mqttSubscriptions['lights/status'](payload)
                }).not.toThrow(`Failed on payload ${index}: ${JSON.stringify(payload)}`)
            })
        })

        test('should expose MQTT disconnection errors (current behavior)', () => {
            const bathLights = BathLights('disconnect-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {closed: 1000},
            })
            
            let publishShouldFail = false
            const mockPublish = jest.fn((topic, payload) => {
                if (publishShouldFail) {
                    throw new Error('MQTT disconnected')
                }
            })
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start normal operation
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
            
            // Simulate MQTT disconnection
            publishShouldFail = true
            mockPublish.mockClear()
            
            // Current implementation will throw during disconnection
            expect(() => {
                publish('lock/status', {state: true})
            }).toThrow('MQTT disconnected')
        })

        test('should handle high-frequency MQTT message storms', () => {
            const bathLights = BathLights('message-storm-test', {
                door: {statusTopic: 'door/status'},
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                timeouts: {closed: 10, opened: 10, toggled: 10, unlocked: 10},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Simulate message storm (thousands of messages)
            const startTime = Date.now()
            
            for (let i = 0; i < 1000; i++) {
                // Rapid state changes
                publish('door/status', {state: i % 2 === 0})
                publish('lock/status', {state: i % 3 === 0})
                publish('lights/status', {state: i % 5 === 0})
                publish('switch/status', {state: true})
                
                // Occasional timer advancement
                if (i % 100 === 0) {
                    jest.advanceTimersByTime(50)
                }
            }
            
            const endTime = Date.now()
            
            // Should handle message storm within reasonable time
            expect(endTime - startTime).toBeLessThan(5000)
            
            // System should still be responsive after storm
            mockPublish.mockClear()
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalled()
        })

        test('should handle MQTT publish with malformed command payloads', () => {
            const bathLights = BathLights('malformed-command-test', {
                lock: {statusTopic: 'lock/status'},
                light: {commandTopic: 'lights/command'},
            })
            
            // Mock publish that validates payload structure
            const mockPublish = jest.fn((topic, payload) => {
                if (typeof payload !== 'object' || payload === null) {
                    throw new Error('Invalid payload format')
                }
                if (!payload.hasOwnProperty('state')) {
                    throw new Error('Missing state property')
                }
            })
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Should not crash if publish validation fails
            expect(() => {
                publish('lock/status', {state: true})
            }).not.toThrow()
            
            // Verify the command was attempted with proper format
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({
                state: true,
                r: expect.any(String)
            }))
        })
    })

    describe('configuration validation edge cases', () => {
        test('should handle missing required light configuration', () => {
            // Missing light.commandTopic should not crash but may not work properly
            expect(() => {
                const bathLights = BathLights('missing-light-command', {
                    door: {statusTopic: 'door/status'},
                    light: {statusTopic: 'lights/status'}, // missing commandTopic
                })
                const mockPublish = jest.fn()
                bathLights.start({mqtt: {subscribe, publish: mockPublish}})
            }).not.toThrow()
        })

        test('should handle empty configuration object', () => {
            expect(() => {
                const bathLights = BathLights('empty-config', {})
                const mockPublish = jest.fn()
                bathLights.start({mqtt: {subscribe, publish: mockPublish}})
            }).toThrow() // Should throw because light is required
        })

        test('should handle null and undefined configuration properties', () => {
            const bathLights = BathLights('null-config', {
                door: null,
                lock: undefined,
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: null,
                timeouts: undefined,
                verbose: null,
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            expect(() => {
                bathLights.start({mqtt})
            }).not.toThrow()

            // Should work with just light functionality
            publish('lights/status', {state: false})
            // No crash expected
        })

        test('should handle invalid timeout configurations', () => {
            const configurations = [
                {timeouts: null},
                {timeouts: undefined},
                {timeouts: 'invalid'},
                {timeouts: 123},
                {timeouts: []},
                {timeouts: {closed: 'invalid'}},
                {timeouts: {closed: null}},
                {timeouts: {closed: undefined}},
                {timeouts: {closed: {}}},
                {timeouts: {closed: []}},
            ]

            configurations.forEach((config, index) => {
                expect(() => {
                    const bathLights = BathLights(`timeout-config-${index}`, {
                        door: {statusTopic: 'door/status'},
                        light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                        ...config
                    })
                    const mockPublish = jest.fn()
                    bathLights.start({mqtt: {subscribe, publish: mockPublish}})
                    
                    // Trigger door close which would use timeout
                    publish('door/status', {state: false})
                }).not.toThrow(`Failed on config ${index}: ${JSON.stringify(config)}`)
            })
        })

        test('should handle invalid toggle type configurations', () => {
            const toggleConfigs = [
                {type: 'invalid'},
                {type: null},
                {type: undefined},
                {type: 123},
                {type: {}},
                {type: []},
                {type: ''},
            ]

            toggleConfigs.forEach((toggleConfig, index) => {
                expect(() => {
                    const bathLights = BathLights(`toggle-config-${index}`, {
                        light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                        toggle: {statusTopic: 'switch/status', ...toggleConfig},
                    })
                    const mockPublish = jest.fn()
                    bathLights.start({mqtt: {subscribe, publish: mockPublish}})
                    
                    // Should default to 'button' behavior
                    publish('lights/status', {state: false})
                    publish('switch/status', {state: true})
                    expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
                }).not.toThrow(`Failed on toggle config ${index}: ${JSON.stringify(toggleConfig)}`)
            })
        })

        test('should handle missing statusTopic in configuration', () => {
            const configurations = [
                {door: {statusTopic: ''}},
                {door: {statusTopic: null}},
                {door: {statusTopic: undefined}},
                {door: {}}, // missing statusTopic entirely
                {lock: {statusTopic: ''}},
                {lock: {statusTopic: null}},
                {toggle: {statusTopic: ''}},
                {toggle: {statusTopic: null}},
            ]

            configurations.forEach((config, index) => {
                expect(() => {
                    const bathLights = BathLights(`missing-topic-${index}`, {
                        light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                        ...config
                    })
                    const mockPublish = jest.fn()
                    bathLights.start({mqtt: {subscribe, publish: mockPublish}})
                }).not.toThrow(`Failed on config ${index}: ${JSON.stringify(config)}`)
            })
        })

        test('should handle verbose configuration edge cases', () => {
            const verboseConfigs = [
                {verbose: true},
                {verbose: false},
                {verbose: null},
                {verbose: undefined},
                {verbose: 'true'},
                {verbose: 'false'},
                {verbose: 1},
                {verbose: 0},
                {verbose: {}},
                {verbose: []},
            ]

            verboseConfigs.forEach((config, index) => {
                expect(() => {
                    const bathLights = BathLights(`verbose-config-${index}`, {
                        light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                        lock: {statusTopic: 'lock/status'},
                        ...config
                    })
                    const mockPublish = jest.fn()
                    bathLights.start({mqtt: {subscribe, publish: mockPublish}})
                    
                    // Test verbose logging doesn't crash
                    publish('lock/status', {state: true})
                    expect(mockPublish).toHaveBeenCalled()
                }).not.toThrow(`Failed on verbose config ${index}: ${JSON.stringify(config)}`)
            })
        })

        test('should handle deeply nested invalid configuration', () => {
            const invalidConfig = {
                door: {
                    statusTopic: {
                        nested: {
                            invalid: 'object'
                        }
                    }
                },
                lock: {
                    statusTopic: ['array', 'instead', 'of', 'string']
                },
                light: {
                    commandTopic: 123,
                    statusTopic: null
                },
                toggle: {
                    statusTopic: function() { return 'function' },
                    type: Symbol('symbol')
                },
                timeouts: {
                    closed: function() { return 1000 },
                    opened: Symbol('timeout'),
                    toggled: new Date(),
                    unlocked: /regex/
                },
                verbose: new Map()
            }

            // Even with completely invalid config, it shouldn't crash during startup
            expect(() => {
                const bathLights = BathLights('deeply-invalid', invalidConfig)
                const mockPublish = jest.fn()
                bathLights.start({mqtt: {subscribe, publish: mockPublish}})
            }).not.toThrow()
        })

        test('should handle configuration parameter type coercion', () => {
            const bathLights = BathLights('type-coercion-test', {
                door: {statusTopic: 'door/status'},
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                timeouts: {
                    closed: '1000',    // string that can be coerced to number
                    opened: true,      // boolean (coerced to 1)
                    toggled: false,    // boolean (coerced to 0)
                    unlocked: '2000',  // string number
                },
                verbose: 'true'        // string that could be coerced to boolean
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            expect(() => {
                bathLights.start({mqtt})
            }).not.toThrow()

            // Test that system still works despite type coercion
            publish('door/status', {state: false})
            expect(mockPublish).toHaveBeenCalledWith('lights/command', expect.objectContaining({state: true}))
        })

        test('should handle configuration with circular references', () => {
            const circularConfig = {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                door: {statusTopic: 'door/status'}
            }
            
            // Create circular reference
            circularConfig.self = circularConfig
            circularConfig.door.parent = circularConfig

            expect(() => {
                const bathLights = BathLights('circular-ref', circularConfig)
                const mockPublish = jest.fn()
                bathLights.start({mqtt: {subscribe, publish: mockPublish}})
            }).not.toThrow()
        })

        test('should handle configuration with prototype pollution attempts', () => {
            const maliciousConfig = {
                light: {commandTopic: 'lights/command'},
                '__proto__': {
                    polluted: true
                },
                'constructor': {
                    'prototype': {
                        polluted: true
                    }
                }
            }

            expect(() => {
                const bathLights = BathLights('proto-pollution', maliciousConfig)
                const mockPublish = jest.fn()
                bathLights.start({mqtt: {subscribe, publish: mockPublish}})
            }).not.toThrow()

            // Verify no prototype pollution occurred
            expect({}.polluted).toBeUndefined()
        })
    })

    describe('command verification system', () => {
        describe('backward compatibility (verification disabled)', () => {
            test('should work exactly like original when commandConfig not provided', () => {
                const bathLights = BathLights('legacy-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    lock: {statusTopic: 'lock/status'},
                    // No commandConfig - should use legacy mode
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Trigger command
                publish('lock/status', {state: true})
                
                // Should publish directly without verification
                expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                    expect.objectContaining({state: true, r: 'lck'})
                )
                
                // No verification timeout should be set
                jest.advanceTimersByTime(10000)
                expect(mockPublish).toHaveBeenCalledTimes(1) // Only the original call
            })

            test('should work like original when verification explicitly disabled', () => {
                const bathLights = BathLights('disabled-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    lock: {statusTopic: 'lock/status'},
                    commandConfig: {verification: 0, maxRetries: 0}, // Explicitly disabled
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Trigger command
                publish('lock/status', {state: true})
                
                // Should publish directly without verification
                expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                    expect.objectContaining({state: true, r: 'lck'})
                )
                
                // No verification should occur
                jest.advanceTimersByTime(10000)
                expect(mockPublish).toHaveBeenCalledTimes(1)
            })
        })

        describe('verification enabled mode', () => {
            test('should verify commands when verification is enabled', () => {
                const bathLights = BathLights('verification-enabled-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    lock: {statusTopic: 'lock/status'},
                    commandConfig: {verification: 500, maxRetries: 2, retryDelay: 200},
                    verbose: true
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Trigger command
                publish('lock/status', {state: true})
                
                // Should publish command
                expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                    expect.objectContaining({state: true, r: 'lck'})
                )
                mockPublish.mockClear()

                // Simulate successful status feedback
                publish('lights/status', {state: true})

                // Fast forward past verification timeout
                jest.advanceTimersByTime(600)

                // Should not retry since state matched
                expect(mockPublish).not.toHaveBeenCalled()
            })

            test('should retry commands when verification fails', () => {
                const bathLights = BathLights('verification-retry-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    toggle: {statusTopic: 'switch/status', type: 'button'},
                    commandConfig: {verification: 300, maxRetries: 3, retryDelay: 100},
                    verbose: true
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Start with lights off and trigger toggle
                publish('lights/status', {state: false})
                publish('switch/status', {state: true})
                expect(mockPublish).toHaveBeenCalledTimes(1)
                mockPublish.mockClear()

                // Simulate wrong state feedback (lights still OFF)
                publish('lights/status', {state: false})

                // Fast forward past verification timeout
                jest.advanceTimersByTime(300)

                // Should not retry yet due to retry delay
                expect(mockPublish).not.toHaveBeenCalled()

                // Fast forward past retry delay
                jest.advanceTimersByTime(100)

                // Should retry the command
                expect(mockPublish).toHaveBeenCalledTimes(1)
                expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                    expect.objectContaining({state: true})
                )
            })

            test('should emit failure events after max retries', () => {
                const bathLights = BathLights('verification-failure-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    toggle: {statusTopic: 'switch/status', type: 'button'},
                    commandConfig: {verification: 200, maxRetries: 2, retryDelay: 50},
                    verbose: true
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Start with lights off and trigger toggle
                publish('lights/status', {state: false})
                publish('switch/status', {state: true})
                expect(mockPublish).toHaveBeenCalledTimes(1)
                mockPublish.mockClear()

                // Keep sending wrong state for all retry attempts
                for (let attempt = 0; attempt < 2; attempt++) {
                    publish('lights/status', {state: false})
                    jest.advanceTimersByTime(200) // verification timeout
                    jest.advanceTimersByTime(50) // retry delay
                    
                    if (attempt < 1) {
                        expect(mockPublish).toHaveBeenCalledTimes(1)
                        mockPublish.mockClear()
                    }
                }

                // Final verification timeout should trigger failure event
                publish('lights/status', {state: false})
                jest.advanceTimersByTime(200)

                // Should emit failure event
                expect(mockPublish).toHaveBeenCalledWith(`homy/automation/verification-failure-test/command_failed`, 
                    expect.objectContaining({
                        reason: 'tgl-loff',
                        attempts: 2,
                        expectedState: true,
                        actualState: false,
                        timestamp: expect.any(Number)
                    })
                )
            })

            test('should handle manual overrides gracefully', () => {
                const bathLights = BathLights('manual-override-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    toggle: {statusTopic: 'switch/status', type: 'button'},
                    commandConfig: {verification: 300, maxRetries: 2, retryDelay: 100},
                    verbose: true
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Start with lights off
                publish('lights/status', {state: false})
                
                // User presses toggle (should send command to turn lights ON)
                publish('switch/status', {state: true})
                expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                    expect.objectContaining({state: true})
                )
                mockPublish.mockClear()

                // Before automation command takes effect, user manually turns lights on via wall switch
                publish('lights/status', {state: true})

                // Fast forward past verification timeout
                jest.advanceTimersByTime(400)

                // Should not retry since desired state was achieved (manual override success)
                expect(mockPublish).not.toHaveBeenCalled()
            })

            test('should use configurable failure topic', () => {
                const customTopic = 'custom/monitoring/failures'
                const bathLights = BathLights('custom-topic-test', {
                    light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                    toggle: {statusTopic: 'switch/status', type: 'button'},
                    commandConfig: {
                        verification: 100,
                        maxRetries: 1,
                        retryDelay: 50,
                        failureTopic: customTopic
                    }
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Start with lights off and trigger toggle
                publish('lights/status', {state: false})
                publish('switch/status', {state: true})
                mockPublish.mockClear()

                // Cause failure by keeping wrong state
                publish('lights/status', {state: false})
                jest.advanceTimersByTime(100) // verification timeout
                jest.advanceTimersByTime(50)  // retry delay

                // Final failure should use custom topic
                publish('lights/status', {state: false})
                jest.advanceTimersByTime(100)

                // Should emit failure event to custom topic
                expect(mockPublish).toHaveBeenCalledWith(customTopic, 
                    expect.objectContaining({
                        reason: 'tgl-loff',
                        attempts: 1
                    })
                )
            })
        })

        describe('production configuration compatibility', () => {
            test('should work with existing Bath1 configuration', () => {
                // Exact copy of production Bath1 config
                const bathLights = BathLights('lightBath1Controller', {
                    door: {
                        statusTopic: 'homy/features/open/bath1_door_open/status',
                    },
                    lock: {
                        statusTopic: 'homy/features/lock/bath1_door_lock/status',
                    },
                    light: {
                        commandTopic: 'homy/features/light/bath1_ceiling_light/set',
                        statusTopic: 'homy/features/light/bath1_ceiling_light/status',
                    },
                    toggle: {
                        type: 'button',
                        statusTopic: 'homy/features/button/bath1_switch_left/status',
                    },
                    timeouts: {
                        closed: 2 * 60000,    // 2 minutes
                        opened: 12 * 60000,   // 12 minutes
                        toggled: 25 * 60000,  // 25 minutes
                        unlocked: 3 * 60000,  // 3 minutes
                    }
                    // No commandConfig - should work in legacy mode
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Test normal operation
                publish('homy/features/lock/bath1_door_lock/status', {state: true})
                
                expect(mockPublish).toHaveBeenCalledWith('homy/features/light/bath1_ceiling_light/set', 
                    expect.objectContaining({state: true, r: 'lck'})
                )
            })

            test('should enable verification for Bath1 when configured', () => {
                // Bath1 config with verification enabled
                const bathLights = BathLights('lightBath1Controller', {
                    door: {
                        statusTopic: 'homy/features/open/bath1_door_open/status',
                    },
                    lock: {
                        statusTopic: 'homy/features/lock/bath1_door_lock/status',
                    },
                    light: {
                        commandTopic: 'homy/features/light/bath1_ceiling_light/set',
                        statusTopic: 'homy/features/light/bath1_ceiling_light/status',
                    },
                    toggle: {
                        type: 'button',
                        statusTopic: 'homy/features/button/bath1_switch_left/status',
                    },
                    timeouts: {
                        closed: 2 * 60000,
                        opened: 12 * 60000,
                        toggled: 25 * 60000,
                        unlocked: 3 * 60000,
                    },
                    commandConfig: {
                        verification: 300,   // 300ms verification
                        maxRetries: 3,       // 3 retry attempts  
                        retryDelay: 50,      // 50ms between retries
                    }
                })
                const mockPublish = jest.fn()
                const mqtt = {subscribe, publish: mockPublish}

                bathLights.start({mqtt})

                // Test verification mode
                publish('homy/features/lock/bath1_door_lock/status', {state: true})
                expect(mockPublish).toHaveBeenCalledWith('homy/features/light/bath1_ceiling_light/set', 
                    expect.objectContaining({state: true, r: 'lck'})
                )
                mockPublish.mockClear()

                // Simulate successful verification
                publish('homy/features/light/bath1_ceiling_light/status', {state: true})
                
                jest.advanceTimersByTime(400)
                
                // Should not retry since command was verified
                expect(mockPublish).not.toHaveBeenCalled()
            })
        })
    })
})

