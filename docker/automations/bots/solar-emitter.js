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

module.exports = (name, {
  statusTopic,
  commandTopic,
  stateParser,
  commandTemplate,
  lat,
  lon,
  solarTimeStates,
  verbose
}) => ({
  start: ({ mqtt }) => {
    let status = null
    let wantedStatus = null

    const update = () => {
      if (status == null || wantedStatus == null) return
      if (status !== wantedStatus) {
        if (verbose) {
          console.log(`[${name}] state different than wanted, publishing`, commandTopic, commandTemplate(wantedStatus))
        }
        mqtt.publish(commandTopic, commandTemplate(wantedStatus))
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
      if (current) wantedStatus = solarTimeStates[current.state]
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

    computeWantedStatus()
  }
})
