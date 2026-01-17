const { CronExpressionParser } = require('cron-parser');

module.exports = (name, {
    valveControlTopic,
    valveControlTemplate = (state) => ({state}),
    schedule,
    duration,
    verbose
}) => ({
    start: ({mqtt}) => {
        const interval = CronExpressionParser.parse(schedule);

        const update = () => {
            const computeWantedStatus = () => {
                const now = new Date()
                interval.reset(now)

                const prevStart = new Date(interval.prev().getTime())
                const prevEnd = new Date(prevStart.getTime() + duration)
                if (prevStart <= now && now < prevEnd) {
                    return {state: true, timeout: prevEnd - now}
                }

                const nextStart = new Date(interval.next().getTime())
                const nextEnd = new Date(nextStart.getTime() + duration)
                if (nextStart <= now && now < nextEnd) {
                    return {state: true, timeout: nextEnd - now}
                }

                return {state: false, timeout: nextStart - now}
            }

            const status = computeWantedStatus()

            if (verbose) {
                console.log(`[${name}] state`, status.state, 'for', status.timeout / 60000, 'minutes')
            }

            mqtt.publish(valveControlTopic, valveControlTemplate(status.state))

            setTimeout(update, status.timeout)
        }

        update()
    }
})
