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
})

