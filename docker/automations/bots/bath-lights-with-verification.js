/**
 * Enhanced Bath lights automation with command verification and retry logic
 * @param {string} name
 * @param {{statusTopic: string}} [door]
 * @param {{statusTopic: string}} [lock]
 * @param {{statusTopic: string, commandTopic: string}} light
 * @param {{statusTopic: string, type?: ('button'|'switch')}} [toggle]
 * @param {{
 *     closed: number,
 *     opened: number,
 *     toggled: number,
 *     unlocked: number,
 * }} [timeouts]
 * @param {{
 *     verification: number,    // timeout for command verification (default: 5000ms)
 *     maxRetries: number,      // max retry attempts (default: 3)
 *     retryDelay: number,      // delay between retries (default: 1000ms)
 * }} [commandConfig]
 * @param {boolean} [verbose]
 * @returns {{start: exports.start}}
 */
module.exports = (name, {
    door,
    lock,
    light,
    toggle,
    timeouts,
    commandConfig = {},
    verbose
}) => ({
    start: ({mqtt}) => {
        let lightState = null
        let lockState = null
        let toggleState = null
        let doorState = null
        let closedTimer = null
        let openedTimer = null
        let toggledTimer = null
        let unlockedTimer = null

        // Command verification configuration
        const config = {
            verification: commandConfig.verification || 5000,  // 5 second timeout
            maxRetries: commandConfig.maxRetries || 3,         // 3 retry attempts
            retryDelay: commandConfig.retryDelay || 1000,      // 1 second between retries
        }

        // Pending commands tracking (state-based)
        const pendingCommands = new Map() // reason -> {expectedState, attempts, timer, etc}
        let commandSequence = 0

        const cancelTimers = () => {
            if (closedTimer) {
                if (verbose) {
                    console.log(`[${name}] cancelling closed timer`)
                }
                clearTimeout(closedTimer)
                closedTimer = null
            }
            if (openedTimer) {
                if (verbose) {
                    console.log(`[${name}] cancelling opened timer`)
                }
                clearTimeout(openedTimer)
                openedTimer = null
            }
            if (toggledTimer) {
                if (verbose) {
                    console.log(`[${name}] cancelling toggled timer`)
                }
                clearTimeout(toggledTimer)
                toggledTimer = null
            }
            if (unlockedTimer) {
                if (verbose) {
                    console.log(`[${name}] cancelling unlocked timer`)
                }
                clearTimeout(unlockedTimer)
                unlockedTimer = null
            }
        }

        const verifiedPublish = (topic, payload, reason) => {
            const expectedState = payload.state
            
            // Cancel any existing command for the same reason to avoid conflicts
            if (pendingCommands.has(reason)) {
                const existingCommand = pendingCommands.get(reason)
                clearTimeout(existingCommand.verificationTimer)
                clearTimeout(existingCommand.retryTimer)
                if (verbose) {
                    console.log(`[${name}] cancelling existing command for reason: ${reason}`)
                }
            }

            const command = {
                topic,
                payload,
                expectedState,
                reason,
                attempts: 0,
                timestamp: Date.now()
            }

            const executeCommand = () => {
                command.attempts++
                
                if (verbose) {
                    console.log(`[${name}] sending command (attempt ${command.attempts}): ${JSON.stringify(command.payload)} for reason: ${reason}`)
                }

                try {
                    mqtt.publish(topic, command.payload)
                } catch (error) {
                    if (verbose) {
                        console.log(`[${name}] command publish failed for reason ${reason}:`, error.message)
                    }
                    // Schedule retry for publish failures
                    scheduleRetry()
                    return
                }

                // Set verification timeout
                const verificationTimer = setTimeout(() => {
                    if (pendingCommands.has(reason)) {
                        if (verbose) {
                            console.log(`[${name}] command verification timeout for ${reason} (expected: ${expectedState}, actual: ${lightState})`)
                        }
                        if (lightState === expectedState) {
                            // State matches - command successful!
                            if (verbose) {
                                console.log(`[${name}] command for ${reason} successful (state verified)`)
                            }
                            cleanupCommand()
                        } else {
                            // State doesn't match - retry needed
                            scheduleRetry()
                        }
                    }
                }, config.verification)

                // Store command for verification
                command.verificationTimer = verificationTimer
                pendingCommands.set(reason, command)
            }

            const scheduleRetry = () => {
                if (command.attempts >= config.maxRetries) {
                    if (verbose) {
                        console.log(`[${name}] command for ${reason} failed after ${command.attempts} attempts - giving up`)
                    }
                    
                    // Emit failure event for monitoring
                    if (mqtt.publish) {
                        try {
                            mqtt.publish(`homy/automation/${name}/command_failed`, {
                                reason,
                                attempts: command.attempts,
                                expectedState,
                                actualState: lightState,
                                timestamp: Date.now()
                            })
                        } catch (e) {
                            // Ignore publish failures for failure events
                        }
                    }
                    
                    cleanupCommand()
                    return
                }

                if (verbose) {
                    console.log(`[${name}] scheduling retry for ${reason} in ${config.retryDelay}ms`)
                }

                const retryTimer = setTimeout(() => {
                    if (pendingCommands.has(reason)) {
                        executeCommand()
                    }
                }, config.retryDelay)
                
                command.retryTimer = retryTimer
            }

            const cleanupCommand = () => {
                const cmd = pendingCommands.get(reason)
                if (cmd) {
                    if (cmd.verificationTimer) clearTimeout(cmd.verificationTimer)
                    if (cmd.retryTimer) clearTimeout(cmd.retryTimer)
                    pendingCommands.delete(reason)
                }
            }

            executeCommand()
        }

        mqtt.subscribe(light.statusTopic, (payload) => {
            if (!payload) return
            
            const previousState = lightState
            lightState = payload.state
            
            if (verbose) {
                console.log(`[${name}] light changed from ${previousState} to ${lightState}`, payload)
            }

            // Check all pending commands for state-based verification
            for (const [reason, command] of pendingCommands.entries()) {
                if (lightState === command.expectedState) {
                    if (verbose) {
                        console.log(`[${name}] command for ${reason} verified successfully (state: ${lightState})`)
                    }
                    // Command successful - clean up
                    if (command.verificationTimer) clearTimeout(command.verificationTimer)
                    if (command.retryTimer) clearTimeout(command.retryTimer)
                    pendingCommands.delete(reason)
                }
                // If state doesn't match, let the verification timeout handle retries
            }

            // Original logic with state change handling
            if (!payload.state) {
                if (lockState) {
                    if (verbose) {
                        console.log(`[${name}] turning on lights from lock`)
                    }
                    verifiedPublish(light.commandTopic, {state: true, r: 'loff-lock'}, 'lock_override')
                }

                cancelTimers()
            }
        })

        if (toggle?.statusTopic) {
            const toggleType = toggle.type || 'button'
            mqtt.subscribe(toggle.statusTopic, (payload) => {
                if (!payload) return
                if (verbose) {
                    console.log(`[${name}] toggle ${toggleType} changed`, payload)
                }
                const changed = toggleState !== payload.state
                toggleState = payload.state
                if ((toggleType === 'switch' && changed) || (toggleType === 'button' && payload.state)) {
                    if (lightState) {
                        if (!lockState) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights`)
                            }
                            verifiedPublish(light.commandTopic, {state: false, r: 'tgl-lon'}, 'toggle_off')
                        }
                    } else {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        verifiedPublish(light.commandTopic, {state: true, r: 'tgl-loff'}, 'toggle_on')
                        if (timeouts?.toggled && !toggledTimer) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights in ${timeouts.toggled / 60000} minutes from toggled timeout`)
                            }
                            toggledTimer = setTimeout(() => {
                                if (verbose) {
                                    console.log(`[${name}] turning off lights from toggled timeout`)
                                }
                                // Check current state before turning off
                                if (lightState !== false && !lockState) {
                                    verifiedPublish(light.commandTopic, {state: false, r: 'tgl-tout'}, 'toggle_timeout')
                                }
                                toggledTimer = null
                            }, timeouts.toggled)
                        }
                    }
                }
            })
        }

        if (lock?.statusTopic) {
            mqtt.subscribe(lock.statusTopic, (payload) => {
                if (!payload) return
                if (verbose) {
                    console.log(`[${name}] lock changed`, payload)
                }
                lockState = payload.state
                if (payload.state) {
                    if (verbose) {
                        console.log(`[${name}] turning on lights`)
                    }
                    verifiedPublish(light.commandTopic, {state: true, r: 'lck'}, 'lock_on')

                    cancelTimers()
                } else if (timeouts?.unlocked != null && !unlockedTimer) {
                    if (verbose) {
                        console.log(`[${name}] turning off lights in ${timeouts.unlocked / 60000} minutes from unlocked timeout`)
                    }
                    unlockedTimer = setTimeout(() => {
                        if (verbose) {
                            console.log(`[${name}] turning off lights from unlocked timeout`)
                        }
                        // Check current state before turning off
                        if (lightState !== false && !lockState) {
                            verifiedPublish(light.commandTopic, {state: false, r: 'unl-tout'}, 'unlock_timeout')
                        }
                        unlockedTimer = null
                    }, timeouts.unlocked)
                }
            })
        }

        if (door?.statusTopic) {
            mqtt.subscribe(door.statusTopic, (payload) => {
                if (!payload) return
                if (verbose) {
                    console.log(`[${name}] door changed`, payload)
                }
                const doorStateChanged = doorState !== payload.state
                doorState = payload.state
                
                if (payload.state) {
                    // Door opened
                    if (unlockedTimer) {
                        if (verbose) {
                            console.log(`[${name}] turning off lights`)
                        }
                        verifiedPublish(light.commandTopic, {state: false, r: 'don-unl'}, 'door_open_unlock')
                        if (verbose) {
                            console.log(`[${name}] cancelling unlocked timer`)
                        }
                        clearTimeout(unlockedTimer)
                        unlockedTimer = null
                    } else if (doorStateChanged) {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        verifiedPublish(light.commandTopic, {state: true, r: 'don'}, 'door_open')
                        if (timeouts?.opened && !openedTimer && !toggledTimer) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights in ${timeouts.opened / 60000} minutes from opened timeout`)
                            }
                            openedTimer = setTimeout(() => {
                                if (verbose) {
                                    console.log(`[${name}] turning off lights from opened timeout`)
                                }
                                // Check current state before turning off
                                if (lightState !== false && !lockState) {
                                    verifiedPublish(light.commandTopic, {state: false, r: 'don-tout'}, 'door_open_timeout')
                                }
                                openedTimer = null
                            }, timeouts.opened)
                        }
                    }
                } else {
                    // Door closed
                    if (doorStateChanged) {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        verifiedPublish(light.commandTopic, {state: true, r: 'doff'}, 'door_close')
                    }
                    if (timeouts?.closed && !closedTimer && !lockState && !toggledTimer) {
                        if (verbose) {
                            console.log(`[${name}] turning off lights in ${timeouts.closed / 60000} minutes from closed timeout`)
                        }
                        closedTimer = setTimeout(() => {
                            if (verbose) {
                                console.log(`[${name}] turning off lights from closed timeout`)
                            }
                            // Check current state before turning off
                            if (lightState !== false && !lockState) {
                                verifiedPublish(light.commandTopic, {state: false, r: 'doff-tout'}, 'door_close_timeout')
                            }
                            closedTimer = null
                        }, timeouts.closed)
                    }
                }
            })
        }
    }
})