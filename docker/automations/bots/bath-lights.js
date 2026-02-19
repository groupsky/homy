/**
 * Bath lights automation with optional command verification
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
 *     verification: number,    // timeout for command verification (default: 0 = disabled)
 *     maxRetries: number,      // max retry attempts (default: 0 = disabled)
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

        // Command verification configuration (safe defaults = disabled)
        const config = {
            verification: commandConfig.verification || 0,     // 0 = disabled
            maxRetries: commandConfig.maxRetries || 0,         // 0 = disabled
            retryDelay: commandConfig.retryDelay || 1000,      // 1 second between retries
            failureTopic: commandConfig.failureTopic,          // no default - opt-in only
        }

        // Pending command tracking (only one command at a time to avoid conflicts)
        let pendingCommand = null

        // Smart publish: legacy mode (direct) or verification mode
        const smartPublish = (topic, payload) => {
            if (config.verification === 0 || config.maxRetries === 0) {
                // Legacy mode - direct publish (existing behavior)
                mqtt.publish(topic, payload)
                return
            }

            // Verification mode - use state-based verification
            const expectedState = payload.state
            const reason = payload.r || 'unknown' // Use payload.r as unified reason
            
            // Cancel any existing pending command to avoid conflicts
            if (pendingCommand) {
                clearTimeout(pendingCommand.verificationTimer)
                clearTimeout(pendingCommand.retryTimer)
                if (verbose) {
                    console.log(`[${name}] cancelling existing command for new command: ${reason}`)
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

            const cleanupCommand = () => {
                if (pendingCommand) {
                    if (pendingCommand.verificationTimer) clearTimeout(pendingCommand.verificationTimer)
                    if (pendingCommand.retryTimer) clearTimeout(pendingCommand.retryTimer)
                    pendingCommand = null
                }
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
                    if (pendingCommand) {
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
                pendingCommand = command
            }

            const scheduleRetry = () => {
                if (command.attempts >= config.maxRetries) {
                    if (verbose) {
                        console.log(`[${name}] command for ${reason} failed after ${command.attempts} attempts - giving up`)
                    }
                    
                    // Emit failure event for monitoring (only if failureTopic configured)
                    if (config.failureTopic) {
                        try {
                            mqtt.publish(config.failureTopic, {
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
                    if (pendingCommand && pendingCommand === command) {
                        executeCommand()
                    }
                }, config.retryDelay)
                
                command.retryTimer = retryTimer
            }

            executeCommand()
        }

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

        mqtt.subscribe(light.statusTopic, (payload) => {
            if (!payload) return
            
            const previousState = lightState
            lightState = payload.state
            
            if (verbose) {
                console.log(`[${name}] light changed from ${previousState} to ${lightState}`, payload)
            }

            // Check pending command for state-based verification (if verification enabled)
            if (config.verification > 0 && config.maxRetries > 0 && pendingCommand) {
                if (lightState === pendingCommand.expectedState) {
                    if (verbose) {
                        console.log(`[${name}] command for ${pendingCommand.reason} verified successfully (state: ${lightState})`)
                    }
                    // Command successful - clean up
                    if (pendingCommand.verificationTimer) clearTimeout(pendingCommand.verificationTimer)
                    if (pendingCommand.retryTimer) clearTimeout(pendingCommand.retryTimer)
                    pendingCommand = null
                }
                // If state doesn't match, let the verification timeout handle retries
            }

            // Original logic with state change handling
            if (!payload.state) {
                if (lockState) {
                    if (verbose) {
                        console.log(`[${name}] turning on lights from lock`)
                    }
                    smartPublish(light.commandTopic, {state: true, r: 'loff-lock'})
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
                if ((toggleType === 'switch' && changed) || (toggleType === 'button' && changed && payload.state)) {
                    if (lightState) {
                        if (!lockState) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights`)
                            }
                            smartPublish(light.commandTopic, {state: false, r: 'tgl-lon'})
                        }
                    } else {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        smartPublish(light.commandTopic, {state: true, r: 'tgl-loff'})
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
                                    smartPublish(light.commandTopic, {state: false, r: 'tgl-tout'})
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
                    smartPublish(light.commandTopic, {state: true, r: 'lck'})

                    cancelTimers()
                } else if (timeouts?.unlocked != null && !unlockedTimer) {
                    if (verbose) {
                        console.log(`[${name}] turning off lights in ${timeouts.unlocked / 60000} minutes from unlocked timeout`)
                    }
                    unlockedTimer = setTimeout(() => {
                        if (verbose) {
                            console.log(`[${name}] turning off lights from unlocked timeout`)
                        }
                        // Check current state before turning off - toggledTimer takes priority
                        if (lightState !== false && !lockState && !toggledTimer) {
                            smartPublish(light.commandTopic, {state: false, r: 'unl-tout'})
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
                        smartPublish(light.commandTopic, {state: false, r: 'don-unl'})
                        if (verbose) {
                            console.log(`[${name}] cancelling unlocked timer`)
                        }
                        clearTimeout(unlockedTimer)
                        unlockedTimer = null
                    } else if (doorStateChanged) {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        smartPublish(light.commandTopic, {state: true, r: 'don'})
                        if (timeouts?.opened && !openedTimer && !toggledTimer) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights in ${timeouts.opened / 60000} minutes from opened timeout`)
                            }
                            openedTimer = setTimeout(() => {
                                if (verbose) {
                                    console.log(`[${name}] turning off lights from opened timeout`)
                                }
                                // Check current state before turning off - toggledTimer takes priority
                                if (lightState !== false && !lockState && !toggledTimer) {
                                    smartPublish(light.commandTopic, {state: false, r: 'don-tout'})
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
                        smartPublish(light.commandTopic, {state: true, r: 'doff'})
                    }
                    if (timeouts?.closed && !closedTimer && !lockState && !toggledTimer) {
                        if (verbose) {
                            console.log(`[${name}] turning off lights in ${timeouts.closed / 60000} minutes from closed timeout`)
                        }
                        closedTimer = setTimeout(() => {
                            if (verbose) {
                                console.log(`[${name}] turning off lights from closed timeout`)
                            }
                            // Check current state before turning off - toggledTimer takes priority
                            if (lightState !== false && !lockState && !toggledTimer) {
                                smartPublish(light.commandTopic, {state: false, r: 'doff-tout'})
                            }
                            closedTimer = null
                        }, timeouts.closed)
                    }
                }
            })
        }
    }
})
