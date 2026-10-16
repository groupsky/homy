// Quiet hours (issue #1744): from 23:00 to 07:00 on the local wall clock, a
// message is sent with Telegram's disable_notification, so it arrives without
// sound. A safety message still rings: a Grafana alert with the label
// safety="true" (set in the rule files under config/grafana), or a direct
// message with "safety": true. At night only the first message of a safety
// alert rings; its repeats are silent (issue #1745). See CLAUDE.md, "Quiet
// hours".
export const QUIET_HOURS = { start: '23:00', end: '07:00', timeZone: 'Europe/Sofia' }

const minutesOfDay = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

// The local time is read in the configured zone, never with a fixed UTC
// offset that would be an hour off for half of the year.
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: QUIET_HOURS.timeZone,
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})
const start = minutesOfDay(QUIET_HOURS.start)
const end = minutesOfDay(QUIET_HOURS.end)

export function isQuietTime(date) {
  const parts = Object.fromEntries(clock.formatToParts(date).map(({ type, value }) => [type, Number(value)]))
  const minute = parts.hour * 60 + parts.minute
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end
}

export function isSafetyMessage(webhookData) {
  if (!webhookData || typeof webhookData !== 'object') return false
  if (webhookData.safety === true) return true
  return Array.isArray(webhookData.alerts) &&
    webhookData.alerts.some((alert) => alert?.labels?.safety === 'true')
}

const safetyAlerts = (webhookData) =>
  webhookData && typeof webhookData === 'object' && Array.isArray(webhookData.alerts)
    ? webhookData.alerts.filter((alert) => alert?.labels?.safety === 'true')
    : []

// The fingerprint names a Grafana alert, and startsAt names its firing
// episode: a repeat carries both unchanged, a new firing has a new startsAt.
const alertId = (alert) => alert.fingerprint ?? JSON.stringify(alert.labels)

// Remembers the firing episode of every safety alert already sent, day or
// night, so that its repeats at night are silent. The memory is lost on a
// restart; the first repeat after it rings once.
export function createQuietHours() {
  const sentEpisodes = new Map()

  const rings = (webhookData) => {
    if (webhookData?.safety === true) return true
    const alerts = safetyAlerts(webhookData)
    const isRepeat = (alert) => sentEpisodes.has(alertId(alert)) && sentEpisodes.get(alertId(alert)) === alert.startsAt
    const ring = alerts.some((alert) => alert.status === 'resolved' || !isRepeat(alert))
    for (const alert of alerts) {
      if (alert.status === 'resolved') sentEpisodes.delete(alertId(alert))
      else sentEpisodes.set(alertId(alert), alert.startsAt)
    }
    return ring
  }

  return {
    sendSilently: (webhookData, date) => {
      const ring = rings(webhookData)
      return isQuietTime(date) && !ring
    },
  }
}
