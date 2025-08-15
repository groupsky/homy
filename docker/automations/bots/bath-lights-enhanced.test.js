const {beforeEach, afterEach, describe, jest, test, expect} = require('@jest/globals')
const BathLights = require('./bath-lights')

// Mock MQTT infrastructure
const mqttSubscriptions = {}
const publish = (topic, payload) => {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic](payload)
    }
}
const subscribe = (topic, callback) => {
    mqttSubscriptions[topic] = callback
}

// Clear subscriptions before each test
beforeEach(() => {
    Object.keys(mqttSubscriptions).forEach(key => delete mqttSubscriptions[key])
    jest.clearAllTimers()
    jest.useFakeTimers()
})

afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
})

describe('bath-lights enhanced with command verification', () => {
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
                commandConfig: {verification: 2000, maxRetries: 2, retryDelay: 500},
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
            jest.advanceTimersByTime(3000)

            // Should not retry since state matched
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should retry commands when verification fails', () => {
            const bathLights = BathLights('verification-retry-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                commandConfig: {verification: 1000, maxRetries: 3, retryDelay: 500},
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
            jest.advanceTimersByTime(1000)

            // Should not retry yet due to retry delay
            expect(mockPublish).not.toHaveBeenCalled()

            // Fast forward past retry delay
            jest.advanceTimersByTime(500)

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
                commandConfig: {verification: 500, maxRetries: 2, retryDelay: 200},
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
                jest.advanceTimersByTime(500) // verification timeout
                jest.advanceTimersByTime(200) // retry delay
                
                if (attempt < 1) {
                    expect(mockPublish).toHaveBeenCalledTimes(1)
                    mockPublish.mockClear()
                }
            }

            // Final verification timeout should trigger failure event
            publish('lights/status', {state: false})
            jest.advanceTimersByTime(500)

            // Should emit failure event
            expect(mockPublish).toHaveBeenCalledWith(`homy/automation/verification-failure-test/command_failed`, 
                expect.objectContaining({
                    reason: 'toggle_on',
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
                commandConfig: {verification: 1000, maxRetries: 2, retryDelay: 300},
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
            jest.advanceTimersByTime(1200)

            // Should not retry since desired state was achieved (manual override success)
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should work with mixed configuration (some verification, some legacy)', () => {
            const bathLights = BathLights('mixed-config-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                commandConfig: {verification: 800, maxRetries: 1, retryDelay: 200},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Test verification mode with toggle
            publish('lights/status', {state: false}) // Start with lights off
            publish('switch/status', {state: true})  // Toggle command
            
            expect(mockPublish).toHaveBeenCalledTimes(1) // toggle command
            mockPublish.mockClear()
            
            // Simulate successful verification
            publish('lights/status', {state: true}) // Should verify toggle command
            
            jest.advanceTimersByTime(1000)
            
            // Should not retry since state matched expectations
            expect(mockPublish).not.toHaveBeenCalled()
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
                    verification: 5000,   // 5 second verification
                    maxRetries: 3,        // 3 retry attempts  
                    retryDelay: 1000,     // 1 second between retries
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
            
            jest.advanceTimersByTime(6000)
            
            // Should not retry since command was verified
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })
})