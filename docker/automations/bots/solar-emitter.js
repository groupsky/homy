const SunCalc = require('suncalc')

const MS_IN_DAY = 24 * 60 * 60 * 1000

// SunCalc reports an event that does not happen on a given day - polar day or
// polar night, or a twilight phase the sun never reaches - as `null` in
// suncalc 2.x and as an invalid Date in suncalc 1.x. Both must be skipped:
// calling .getTime() on null throws, and on an invalid Date it yields NaN,
// which then poisons the comparisons that pick the current and next state.
const timestampOf = (time) => {
  if (time == null) return null
  const ms = time.getTime()
  return Number.isNaN(ms) ? null : ms
}

// A clear on or off. Anything else - no message, a missing or odd value - is
// unknown, and unknown means the lights follow the sun as usual.
const holdOffStateOf = (payload) => {
  const state = payload != null && typeof payload === 'object' ? payload.state : undefined
  return typeof state === 'boolean' ? state : null
}

module.exports = (name, {
  statusTopic,
  commandTopic,
  stateParser,
  commandTemplate,
  lat,
  lon,
  solarTimeStates,
  // Optional "hold off" switch, for example a night with a clear sky. While it
  // is on, a state that wants the lights on (`true`) is held at `false`. It
  // counts only for the night after it was turned on, and turns itself off at
  // the next sunrise. The switch is a feature in the local features service.
  holdOffStatusTopic,
  holdOffSetTopic,
  verbose
}) => ({
  // The time the switch was turned on is kept only when the status message
  // does not carry one.
  ...(holdOffStatusTopic && holdOffSetTopic && {
    persistedCache: { version: 1, default: { holdOffSince: null } }
  }),
  start: (params) => {
    const { mqtt } = params
    const holdOffConfigured = Boolean(holdOffStatusTopic && holdOffSetTopic)
    // The house location comes from the real .env. Without it SunCalc gives no
    // times, and the bot would silently never switch, so it says so and stays off.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.error(`[${name}] no house location: set WEATHER_LATITUDE and WEATHER_LONGITUDE in .env; not started`)
      return
    }
    let status = null
    let wantedStatus = null

    // Hold-off state. `lastOffAt` is the most recent event that wants the
    // lights off (sunrise) that has already happened.
    const cache = holdOffConfigured ? (params.persistedCache || {}) : null
    let holdOffOn = false
    let holdOffOnAt = null
    let lastOffAt = null
    let offRequested = false
    // What was last written to the log, so each event is logged once.
    let loggedSwitchOn = null
    let loggedWanted = null

    // The switch counts only while no sunrise has passed since it was turned on.
    const holdOffExpired = () => holdOffOnAt != null && lastOffAt != null && lastOffAt >= holdOffOnAt
    const holdOffActive = () => holdOffOn && !holdOffExpired()

    const requestHoldOffOff = (reason) => {
      if (!holdOffOn || offRequested) return
      offRequested = true
      console.log(`[${name}] ${reason}`)
      if (verbose) console.log(`[${name}] turning the hold-off switch off`, holdOffSetTopic)
      mqtt.publish(holdOffSetTopic, { state: false })
    }

    const update = () => {
      if (holdOffConfigured && holdOffExpired()) requestHoldOffOff('hold-off switch is from before the last sunrise: turning it off')
      if (wantedStatus != null && holdOffConfigured) {
        const held = wantedStatus === true && holdOffActive()
        const wanted = wantedStatus && !held ? 'on' : held ? 'off (hold-off)' : 'off'
        if (wanted !== loggedWanted) {
          loggedWanted = wanted
          console.log(`[${name}] wanted: ${wanted}`)
        }
      }
      if (status == null || wantedStatus == null) return
      const effective = wantedStatus === true && holdOffActive() ? false : wantedStatus
      if (status !== effective) {
        if (verbose) {
          console.log(`[${name}] state different than wanted, publishing`, commandTopic, commandTemplate(effective))
        }
        mqtt.publish(commandTopic, commandTemplate(effective))
      }
    }

    const computeWantedStatus = () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - MS_IN_DAY)
      const tomorrow = new Date(now.getTime() + MS_IN_DAY)
      const timesYesterday = SunCalc.getTimes(yesterday, lat, lon)
      const timesToday = SunCalc.getTimes(now, lat, lon)
      const timesTomorrow = SunCalc.getTimes(tomorrow, lat, lon)
      const states = []
      for (const state in solarTimeStates) {
        for (const times of [timesYesterday, timesToday, timesTomorrow]) {
          const timestamp = timestampOf(times[state])
          if (timestamp === null) continue
          states.push({ state, eta: timestamp - now.getTime() })
        }
      }
      const passed = states.filter(({ eta }) => eta <= 0)
      const upcoming = states.filter(({ eta }) => eta > 0)
      // The most recent event that has already happened is the current state;
      // the soonest one still ahead is when to look again.
      const current = passed.length ? passed.reduce((best, candidate) => best.eta < candidate.eta ? candidate : best) : null
      const next = upcoming.length ? upcoming.reduce((best, candidate) => best.eta > candidate.eta ? candidate : best) : null
      if (verbose) {
        if (current) console.log(`[${name}] current state`, current.state, 'since', -Math.round(current.eta / 60000), 'm')
        else console.log(`[${name}] no configured solar event has happened in the last day, keeping`, wantedStatus)
        if (next) console.log(`[${name}] next state`, next.state, 'in', Math.round(next.eta / 60000), 'm')
        else console.log(`[${name}] no configured solar event ahead, checking again in a day`)
      }
      const previousWanted = wantedStatus
      if (current) wantedStatus = solarTimeStates[current.state]
      if (holdOffConfigured) {
        const offEvents = passed.filter(({ state }) => solarTimeStates[state] === false)
        lastOffAt = offEvents.length ? now.getTime() + Math.max(...offEvents.map(({ eta }) => eta)) : null
        // Sunrise ends the night the switch was for.
        if (previousWanted === true && wantedStatus === false) requestHoldOffOff('sunrise: turning the hold-off switch off')
      }
      // With every configured event missing - a full polar day or night - there
      // is nothing to schedule against, so retry once a day until one returns.
      setTimeout(computeWantedStatus, next ? next.eta : MS_IN_DAY)
      update()
    }

    mqtt.subscribe(statusTopic, (payload) => {
      status = Boolean(stateParser(payload))
      if (verbose) {
        console.log(`[${name}] status updated to`, status)
      }
      update()
    })

    if (holdOffConfigured) {
      mqtt.subscribe(holdOffStatusTopic, (payload) => {
        const state = holdOffStateOf(payload)
        const previousOnAt = holdOffOnAt
        holdOffOn = state === true
        if (holdOffOn) {
          if (Number.isFinite(payload._tz)) {
            holdOffOnAt = payload._tz
          } else {
            if (cache.holdOffSince == null) cache.holdOffSince = Date.now()
            holdOffOnAt = cache.holdOffSince
          }
        } else {
          holdOffOnAt = null
          if (state === false) cache.holdOffSince = null
        }
        // The switch-off is asked for, and logged, once per on-period: until the
        // switch goes off or is turned on again with a new time.
        if (!holdOffOn || holdOffOnAt !== previousOnAt) offRequested = false
        if (holdOffOn && loggedSwitchOn !== true) {
          console.log(`[${name}] hold-off switch on (since ${new Date(holdOffOnAt).toISOString()})`)
        } else if (!holdOffOn && loggedSwitchOn === true) {
          console.log(`[${name}] hold-off switch off`)
        }
        loggedSwitchOn = holdOffOn
        if (verbose) console.log(`[${name}] hold-off switch is`, holdOffOn)
        update()
      })
    }

    computeWantedStatus()
  }
})
