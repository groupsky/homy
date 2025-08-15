const {beforeEach, afterEach, describe, jest, test, expect} = require('@jest/globals')
const BathLights = require('./bath-lights-with-verification')

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

describe('bath-lights with state-based verification', () => {
    describe('basic state verification', () => {
        test('should verify successful commands when state matches', () => {
            const bathLights = BathLights('verification-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 2000, maxRetries: 2, retryDelay: 500},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Trigger a command
            publish('lock/status', {state: true})
            
            // Should publish command
            expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                expect.objectContaining({
                    state: true,
                    r: 'lck'
                })
            )
            mockPublish.mockClear()

            // Simulate successful status feedback (state matches expected)
            publish('lights/status', {state: true})

            // Fast forward past verification timeout
            jest.advanceTimersByTime(3000)

            // Should not retry since state matched
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should retry commands when state does not match', () => {
            const bathLights = BathLights('retry-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'}, // Use toggle instead of lock to avoid override
                commandConfig: {verification: 1000, maxRetries: 3, retryDelay: 500},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start with lights off, then trigger toggle to turn lights ON
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(1)
            mockPublish.mockClear()

            // Simulate wrong state feedback (lights still OFF) - this won't trigger lock override
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

        test('should give up after max retries and emit failure event', () => {
            const bathLights = BathLights('failure-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                commandConfig: {verification: 500, maxRetries: 2, retryDelay: 200},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start with lights off and trigger toggle to turn lights ON
            publish('lights/status', {state: false})
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(1)
            mockPublish.mockClear()

            // Keep sending wrong state (command never succeeds)
            for (let attempt = 0; attempt < 2; attempt++) {
                // Wrong state during verification (lights remain OFF)
                publish('lights/status', {state: false})
                
                // Wait for verification timeout
                jest.advanceTimersByTime(500)
                
                // Wait for retry delay
                jest.advanceTimersByTime(200)
                
                if (attempt < 1) { // Don't check on last attempt
                    expect(mockPublish).toHaveBeenCalledTimes(1)
                    mockPublish.mockClear()
                }
            }

            // Final verification timeout should trigger failure event
            publish('lights/status', {state: false})
            jest.advanceTimersByTime(500)

            // Should emit failure event
            expect(mockPublish).toHaveBeenCalledWith(`homy/automation/failure-test/command_failed`, 
                expect.objectContaining({
                    reason: 'toggle_on',
                    attempts: 2,
                    expectedState: true,
                    actualState: false,
                    timestamp: expect.any(Number)
                })
            )
        })
    })

    describe('manual override and external changes', () => {
        test('should consider command successful if manual override achieves desired state', () => {
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

            // Before automation command takes effect, user manually turns lights on via another switch
            // This achieves the desired state even though it wasn't our command
            publish('lights/status', {state: true})

            // Fast forward past verification timeout
            jest.advanceTimersByTime(1200)

            // Should not retry since desired state was achieved (manual override)
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should handle multiple external state changes correctly', () => {
            const bathLights = BathLights('external-changes-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 800, maxRetries: 2, retryDelay: 200},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Issue command to turn lights ON
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(1)
            mockPublish.mockClear()

            // External system turns lights off and on rapidly
            publish('lights/status', {state: false})
            publish('lights/status', {state: true})  // Final state matches our command
            publish('lights/status', {state: false})
            publish('lights/status', {state: true})  // Final state matches our command

            // Fast forward past verification timeout
            jest.advanceTimersByTime(900)

            // Should not retry since final state matches our expectation
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should handle rapid command changes with different expected states', () => {
            const bathLights = BathLights('rapid-commands-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 500, maxRetries: 2, retryDelay: 100},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start with lights on
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // Rapid sequence: toggle OFF, then lock ON
            publish('switch/status', {state: true}) // Should turn OFF
            publish('lock/status', {state: true})   // Should turn ON (cancels previous)

            expect(mockPublish).toHaveBeenCalledTimes(2)
            // Last command should be turn ON due to lock
            expect(mockPublish).toHaveBeenLastCalledWith('lights/command', 
                expect.objectContaining({state: true, r: 'lck'})
            )
            mockPublish.mockClear()

            // Provide feedback that lights are ON (matches last command)
            publish('lights/status', {state: true})

            // Fast forward past verification timeout
            jest.advanceTimersByTime(600)

            // Should not retry since state matches the last (winning) command
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('network failure scenarios', () => {
        test('should retry on publish failures', () => {
            const bathLights = BathLights('publish-failure-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 600, maxRetries: 3, retryDelay: 200},
                verbose: true
            })
            
            let shouldFailPublish = true
            const mockPublish = jest.fn((topic, payload) => {
                if (shouldFailPublish && topic === 'lights/command') {
                    throw new Error('MQTT publish failed')
                }
            })
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Trigger command that will fail to publish
            publish('lock/status', {state: true})
            
            // Should have attempted publish once (which failed)
            expect(mockPublish).toHaveBeenCalledTimes(1)
            mockPublish.mockClear()

            // Wait for retry
            jest.advanceTimersByTime(200)

            // Should retry publish
            expect(mockPublish).toHaveBeenCalledTimes(1)

            // Now allow publish to succeed
            shouldFailPublish = false
            mockPublish.mockClear()

            // Wait for next retry
            jest.advanceTimersByTime(200)
            
            expect(mockPublish).toHaveBeenCalledTimes(1)
            expect(mockPublish).toHaveBeenCalledWith('lights/command', 
                expect.objectContaining({state: true})
            )
        })

        test('should handle delayed status feedback gracefully', () => {
            const bathLights = BathLights('delayed-feedback-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 500, maxRetries: 2, retryDelay: 200},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Issue command
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(1)
            mockPublish.mockClear()

            // Let it timeout and start retrying
            jest.advanceTimersByTime(500) // verification timeout (no status feedback)
            jest.advanceTimersByTime(200) // retry delay
            expect(mockPublish).toHaveBeenCalledTimes(1) // first retry
            mockPublish.mockClear()

            // Now provide very late status feedback from original command
            publish('lights/status', {state: true})

            // Should immediately stop retrying since state now matches
            jest.advanceTimersByTime(500) // would be verification timeout for retry
            jest.advanceTimersByTime(200) // would be next retry delay

            // Should not retry again since state was verified
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })

    describe('edge cases and error conditions', () => {
        test('should handle null/undefined status gracefully', () => {
            const bathLights = BathLights('null-status-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 300, maxRetries: 1, retryDelay: 100},
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Issue command
            publish('lock/status', {state: true})
            mockPublish.mockClear()

            // Send null status updates
            publish('lights/status', null)
            publish('lights/status', undefined)
            publish('lights/status', {})
            publish('lights/status', {state: undefined})

            // Should not crash and should continue trying to verify
            jest.advanceTimersByTime(400)
            
            // System should still be functioning
            expect(() => {
                publish('lights/status', {state: true})
            }).not.toThrow()
        })

        test('should clean up properly when commands are cancelled by new commands', () => {
            const bathLights = BathLights('cleanup-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                toggle: {statusTopic: 'switch/status', type: 'button'},
                commandConfig: {verification: 1000, maxRetries: 2, retryDelay: 300},
                verbose: true
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Start with lights on
            publish('lights/status', {state: true})
            mockPublish.mockClear()

            // Issue first command (turn off)
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(1)

            // Issue second command quickly (turn off again - should cancel first)
            publish('switch/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(2)
            mockPublish.mockClear()

            // Only the last command should be pending verification
            // Verify with correct state
            publish('lights/status', {state: false})

            jest.advanceTimersByTime(1200)

            // Should not retry since state was verified
            expect(mockPublish).not.toHaveBeenCalled()
        })

        test('should handle system disable via configuration', () => {
            const bathLights = BathLights('disabled-test', {
                light: {commandTopic: 'lights/command', statusTopic: 'lights/status'},
                lock: {statusTopic: 'lock/status'},
                commandConfig: {verification: 0, maxRetries: 0}, // Disable verification
            })
            const mockPublish = jest.fn()
            const mqtt = {subscribe, publish: mockPublish}

            bathLights.start({mqtt})

            // Issue command
            publish('lock/status', {state: true})
            expect(mockPublish).toHaveBeenCalledTimes(1)
            mockPublish.mockClear()

            // Fast forward - should not retry since verification is disabled
            jest.advanceTimersByTime(5000)
            expect(mockPublish).not.toHaveBeenCalled()
        })
    })
})