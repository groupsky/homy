module.exports = (name, {
    door,
    lock,
    light,
    toggle,
    timeouts,
    verbose
}) => ({
    start: ({mqtt}) => {
        let lightState = null
        let lockState = null
        let toggleState = null
        let closedTimer = null
        let openedTimer = null
        let toggledTimer = null
        let unlockedTimer = null

        mqtt.subscribe(light.statusTopic, (payload) => {
            if (verbose) {
                console.log(`[${name}] light changed`, payload)
            }
            lightState = payload.state
            if (!payload.state) {
                if (lockState) {
                    if (verbose) {
                        console.log(`[${name}] turning on lights from lock`)
                    }
                    mqtt.publish(light.commandTopic, {state: true, r: 'loff-lock'})
                }

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
        })

        if (toggle?.statusTopic) {
            const toggleType = toggle.type || 'button'
            mqtt.subscribe(toggle.statusTopic, (payload) => {
                if (verbose) {
                    console.log(`[${name}] toggle ${toggleType} changed`, payload)
                }
                const changed = toggleState !== payload.state
                toggleState = payload.state
                if ((toggleType === 'switch' && changed) || (toggleType === 'button' && payload.state)) {
                    if (lightState) {
                        if (!lockState) {
                            if (verbose) {
                                console.log('[${name}] turning off lights')
                            }
                            mqtt.publish(light.commandTopic, {state: false, r: 'tgl-lon'})
                        }
                    } else {
                        if (verbose) {
                            console.log('[${name}] turning on lights')
                        }
                        mqtt.publish(light.commandTopic, {state: true, r: 'tgl-loff'})
                        if (timeouts?.toggled && !toggledTimer) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights in ${timeouts.toggled / 60000} minutes from toggled timeout`)
                            }
                            toggledTimer = setTimeout(() => {
                                if (verbose) {
                                    console.log(`[${name}] turning off lights from toggled timeout`)
                                }
                                mqtt.publish(light.commandTopic, {state: false, r: 'tgl-tout'})
                            }, timeouts.toggled)
                        }
                    }
                }
            })
        }

        if (lock?.statusTopic) {
            mqtt.subscribe(lock.statusTopic, (payload) => {
                if (verbose) {
                    console.log(`[${name}] lock changed`, payload)
                }
                lockState = payload.state
                if (payload.state) {
                    if (verbose) {
                        console.log(`[${name}] turning on lights`)
                    }
                    mqtt.publish(light.commandTopic, {state: true, r: 'lck'})
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
                } else if (timeouts?.unlocked != null && !unlockedTimer) {
                    if (verbose) {
                        console.log(`[${name}] turning off lights in ${timeouts.unlocked / 60000} minutes from unlocked timeout`)
                    }
                    unlockedTimer = setTimeout(() => {
                        if (verbose) {
                            console.log(`[${name}] turning off lights from unlocked timeout`)
                        }
                        mqtt.publish(light.commandTopic, {state: false, r: 'unl-tout'})
                    }, timeouts.unlocked)
                }
            })
        }

        if (door?.statusTopic) {
            mqtt.subscribe(door.statusTopic, (payload) => {
                if (verbose) {
                    console.log(`[${name}] door changed`, payload)
                }
                if (payload.state) {
                    if (unlockedTimer) {
                        if (verbose) {
                            console.log(`[${name}] turning off lights`)
                        }
                        mqtt.publish(light.commandTopic, {state: false, r: 'don-unl'})
                        if (verbose) {
                            console.log(`[${name}] cancelling unlocked timer`)
                        }
                        clearTimeout(unlockedTimer)
                        unlockedTimer = null
                    } else {
                        if (verbose) {
                            console.log(`[${name}] turning on lights`)
                        }
                        mqtt.publish(light.commandTopic, {state: true, r: 'don'})
                        if (timeouts?.opened && !openedTimer) {
                            if (verbose) {
                                console.log(`[${name}] turning off lights in ${timeouts.opened / 60000} minutes from opened timeout`)
                            }
                            openedTimer = setTimeout(() => {
                                if (verbose) {
                                    console.log(`[${name}] turning off lights from opened timeout`)
                                }
                                mqtt.publish(light.commandTopic, {state: false, r: 'don-tout'})
                            }, timeouts.opened)
                        }
                    }
                } else {
                    if (verbose) {
                        console.log(`[${name}] turning on lights`)
                    }
                    mqtt.publish(light.commandTopic, {state: true, r: 'doff'})
                    if (timeouts?.closed && !closedTimer) {
                        if (verbose) {
                            console.log(`[${name}] turning off lights in ${timeouts.closed / 60000} minutes from closed timeout`)
                        }
                        closedTimer = setTimeout(() => {
                            if (verbose) {
                                console.log(`[${name}] turning off lights from closed timeout`)
                            }
                            mqtt.publish(light.commandTopic, {state: false, r: 'doff-tout'})
                        }, timeouts.closed)
                    }
                }
            })
        }
    }
})
