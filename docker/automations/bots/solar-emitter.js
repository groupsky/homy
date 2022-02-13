const SunCalc = require('suncalc')

const MS_IN_DAY = 24 * 60 * 60 * 1000

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
          console.log('state different than wanted, publishing', commandTopic, commandTemplate(wantedStatus))
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
        states.push({ state, eta: timesYesterday[state].getTime() - now.getTime() })
        states.push({ state, eta: timesToday[state].getTime() - now.getTime() })
        states.push({ state, eta: timesTomorrow[state].getTime() - now.getTime() })
      }
      const current = states.reduce((best, current) => best.eta > 0 || current.eta <= 0 && best.eta < current.eta ? current : best)
      const next = states.reduce((best, current) => best.eta <= 0 || current.eta > 0 && best.eta > current.eta ? current : best)
      if (verbose) {
        console.log('current state', current.state, 'since', -Math.round(current.eta / 60000), 'm')
        console.log('next state', next.state, 'in', Math.round(next.eta / 60000), 'm')
      }
      wantedStatus = solarTimeStates[current.state]
      setTimeout(computeWantedStatus, next.eta)
      update()
    }

    mqtt.subscribe(statusTopic, (payload) => {
      status = Boolean(stateParser(payload))
      if (verbose) {
        console.log('status updated to', status)
      }
      update()
    })

    computeWantedStatus()
  }
})
