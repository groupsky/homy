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
 *     toggledOff?: number,   // a door change this soon after a wall-switch off does not turn the lights on
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
    // The deadline of each pending off timer (epoch ms), so a restart can re-arm it
    persistedCache: {
        version: 1,
        default: {deadlines: {closed: null, opened: null, toggled: null, unlocked: null}},
    },

    start: ({mqtt, persistedCache}) => {
        const cache = persistedCache || {deadlines: {closed: null, opened: null, toggled: null, unlocked: null}}
        let lightState = null
        let lockState = null
        let toggleState = null
        let doorState = null
        const timers = {closed: null, opened: null, toggled: null, unlocked: null}
        let toggledOffAt = -Infinity

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

        // Someone turned the lights off with the wall switch and is leaving. A
        // debounced door contact reports the door opening or closing late, after
        // the press, so that door event must not turn the lights on again.
        const toggledOffRecently = () =>
            timeouts?.toggledOff && Date.now() - toggledOffAt < timeouts.toggledOff

        const offReasons = {closed: 'doff-tout', opened: 'don-tout', toggled: 'tgl-tout', unlocked: 'unl-tout'}

        // Deadlines saved before a restart. Like door-alarm, they are not acted
        // on until the light reports its live state: a light that went off while
        // the bot was down needs no command.
        const restored = {...cache.deadlines}
        let restorePending = Object.values(restored).some((deadline) => deadline != null)

        const disarm = (kind) => {
            if (timers[kind]) {
                if (verbose) {
                    console.log(`[${name}] cancelling ${kind} timer`)
                }
                clearTimeout(timers[kind])
                timers[kind] = null
            }
            cache.deadlines[kind] = null
            // A cancel before the first light status also cancels the saved timer
            restored[kind] = null
        }

        const cancelTimers = () => {
            Object.keys(timers).forEach(disarm)
        }

        // An off timer ran out: turn the lights off, unless they are already
        // off, the door is locked, or a toggled timer is pending (it has priority)
        const fire = (kind) => {
            timers[kind] = null
            cache.deadlines[kind] = null
            restored[kind] = null
            if (verbose) {
                console.log(`[${name}] turning off lights from ${kind} timeout`)
            }
            if (lightState !== false && !lockState && (kind === 'toggled' || !timers.toggled)) {
                smartPublish(light.commandTopic, {state: false, r: offReasons[kind]})
            }
        }

        const arm = (kind, ms) => {
            if (verbose) {
                console.log(`[${name}] turning off lights in ${ms / 60000} minutes from ${kind} timeout`)
            }
            timers[kind] = setTimeout(() => fire(kind), ms)
            cache.deadlines[kind] = Date.now() + ms
        }

        const restoreTimers = () => {
            const now = Date.now()
            let expired = null
            // toggled first, so it is pending when the others check its priority
            for (const kind of ['toggled', 'unlocked', 'opened', 'closed']) {
                const deadline = restored[kind]
                if (deadline == null || timers[kind]) continue
                if (deadline > now) {
                    arm(kind, deadline - now)
                } else {
                    // The deadline passed while the bot was down
                    cache.deadlines[kind] = null
                    expired = expired || kind
                }
            }
            // Several timers may have run out; the lights go off only once
            if (expired) fire(expired)
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

            if (restorePending) {
                restorePending = false
                if (payload.state) {
                    restoreTimers()
                }
                // A light that is off clears the saved deadlines below
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
                            toggledOffAt = Date.now()
                        }
                    } else {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        smartPublish(light.commandTopic, {state: true, r: 'tgl-loff'})
                        if (timeouts?.toggled && !timers.toggled) {
                            arm('toggled', timeouts.toggled)
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
                const lockStateChanged = lockState !== payload.state
                lockState = payload.state
                // Ignore redundant re-published lock states. All dry-switch
                // features on a Modbus DI module re-publish together whenever any
                // single input on that module changes, so an unrelated door
                // elsewhere causes this lock's last state to be re-emitted
                // unchanged. Only a genuine lock/unlock transition should drive
                // the light - otherwise a re-published "unlocked" arms a spurious
                // unlock timer that the matching "door open" re-publish then turns
                // into a bogus 'don-unl' off command.
                if (!lockStateChanged) return
                if (payload.state) {
                    if (verbose) {
                        console.log(`[${name}] turning on lights`)
                    }
                    smartPublish(light.commandTopic, {state: true, r: 'lck'})

                    cancelTimers()
                } else if (timeouts?.unlocked != null && !timers.unlocked) {
                    arm('unlocked', timeouts.unlocked)
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
                
                // Only react to genuine transitions. A re-published "still
                // open"/"still closed" status (all dry-switch features on a
                // Modbus DI module re-publish together whenever any single input
                // on that module changes) must not be treated as the user
                // operating this door, otherwise it spuriously fires 'don-unl'
                // (while an unlock timer is pending) or re-arms the closed
                // timeout and turns an intentionally-on light off.
                if (!doorStateChanged) {
                    return
                }

                if (payload.state) {
                    // Door opened. A door open ends an unlocked timer, also one
                    // saved before a restart and not yet restored
                    restored.unlocked = null
                    if (timers.unlocked) {
                        if (verbose) {
                            console.log(`[${name}] turning off lights`)
                        }
                        smartPublish(light.commandTopic, {state: false, r: 'don-unl'})
                        disarm('unlocked')
                    } else if (toggledOffRecently()) {
                        if (verbose) {
                            console.log(`[${name}] keeping lights off, the wall switch turned them off ${Date.now() - toggledOffAt}ms ago`)
                        }
                    } else {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        smartPublish(light.commandTopic, {state: true, r: 'don'})
                        if (timeouts?.opened && !timers.opened && !timers.toggled) {
                            arm('opened', timeouts.opened)
                        }
                    }
                } else if (toggledOffRecently()) {
                    // Door closed right after a wall-switch off
                    if (verbose) {
                        console.log(`[${name}] keeping lights off, the wall switch turned them off ${Date.now() - toggledOffAt}ms ago`)
                    }
                } else {
                    // Door closed
                    if (verbose) {
                        console.log(`[${name}] turning on lights`)
                    }
                    smartPublish(light.commandTopic, {state: true, r: 'doff'})
                    if (timeouts?.closed && !timers.closed && !lockState && !timers.toggled) {
                        arm('closed', timeouts.closed)
                    }
                }
            })
        }
    }
})
