/**
 * Safety Siren Bot (#1770)
 *
 * Sounds the hall siren for life-safety alerts. Each alert watches one
 * numeric feature topic and fires when the value stays above its limit for
 * `confirmMs`, with fresh readings. It never sounds for "no data": a missing,
 * stale, null or non-numeric reading never starts or keeps an alert.
 *
 * Stop: a hall wall button (only while a siren alert or test is active, so
 * the buttons keep working for the lights), the Home Assistant stop button,
 * the alert clearing, or the maintenance mute. The mute is a Home Assistant
 * switch that turns itself off after `mute.maxMs`.
 *
 * Siren alive check: a Telegram message when the siren has sent nothing for
 * `aliveMaxAgeMs`, by its zigbee2mqtt `last_seen` (a state sent again after a
 * zigbee2mqtt restart carries the old `last_seen`, so it is no sign of life).
 *
 * Commands go to the z2m set topic as plain JSON (no `_bot`/`_tz`, #1713).
 * See docs/safety-siren.md.
 */
const { watchInputAge } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')

const VOLUMES = ['low', 'medium', 'high']
const CHECK_INTERVAL_MS = 10 * 1000

module.exports = (name, config) => {
  const {
    siren,
    alerts,
    stopButtonTopics = [],
    stopTopic,
    test,
    mute,
    day = { fromHour: 7, toHour: 23, timeZone: 'Europe/Sofia' },
    aliveMaxAgeMs = 3 * 60 * 60 * 1000,
    telegramUrl,
    httpPost,
    verbose = false
  } = config

  if (!siren?.commandTopic) throw new Error(`[${name}] siren.commandTopic is required`)
  if (!siren?.stateTopic) throw new Error(`[${name}] siren.stateTopic is required`)
  if (!Array.isArray(alerts)) throw new Error(`[${name}] alerts must be an array`)
  const checkSound = (where, { melody, volume, durationSec }) => {
    if (!Number.isInteger(melody)) throw new Error(`[${name}] ${where}.melody must be a whole number`)
    if (!VOLUMES.includes(volume)) throw new Error(`[${name}] ${where}.volume must be 'low', 'medium' or 'high'`)
    if (!(durationSec > 0)) throw new Error(`[${name}] ${where}.durationSec must be a positive number`)
  }
  alerts.forEach((alert, i) => {
    const where = `alerts[${i}]`
    if (!alert.name || !alert.topic) throw new Error(`[${name}] ${where}.name and .topic are required`)
    if (typeof alert.above !== 'number') throw new Error(`[${name}] ${where}.above must be a number`)
    if (!(alert.confirmMs > 0) || !(alert.maxAgeMs > 0)) throw new Error(`[${name}] ${where}.confirmMs and .maxAgeMs must be positive`)
    checkSound(where, alert)
  })
  if (test) checkSound('test', test)

  const log = (...args) => { if (verbose) console.log(`[${name}]`, ...args) }

  const localHour = new Intl.DateTimeFormat('en-GB', { timeZone: day.timeZone, hour: 'numeric', hourCycle: 'h23' })
  const isDay = (ms) => {
    const hour = Number(localHour.format(ms))
    return hour >= day.fromHour && hour < day.toHour
  }

  return {
    persistedCache: {
      version: 1,
      default: { muteUntil: null },
      migrate: ({ state }) => state
    },

    start: async ({ mqtt, persistedCache, isEnabled }) => {
      const sendTelegram = telegramAlert({ url: telegramUrl, httpPost, isEnabled })

      // Per alert: when the value went above the limit, the last good reading,
      // and the current episode (from confirmed to cleared).
      const watch = alerts.map((alert) => ({ alert, aboveSince: null, lastReadingAt: null, episode: null }))
      let soundingUntil = 0
      let testSoundingUntil = 0

      const sound = async ({ melody, volume, durationSec }) => {
        soundingUntil = Date.now() + durationSec * 1000
        await mqtt.publish(siren.commandTopic, { alarm: true, melody, volume, duration: durationSec })
      }
      const silence = async () => {
        soundingUntil = 0
        testSoundingUntil = 0
        await mqtt.publish(siren.commandTopic, { alarm: false })
      }
      const isSounding = () => Date.now() < soundingUntil

      const isMuted = () => persistedCache.muteUntil != null && Date.now() < persistedCache.muteUntil
      const publishMute = () => mqtt.publish(mute.statusTopic, { state: isMuted() }, { retain: true })

      const clear = async (w, why) => {
        if (!w.episode) return
        log(`${w.alert.name} cleared (${why})`)
        w.episode = null
        if (isSounding()) await silence()
      }

      // Called on every reading and every CHECK_INTERVAL_MS. It starts no
      // episode: only a reading does (see the subscription below).
      const evaluate = async (w) => {
        const now = Date.now()
        const { alert } = w
        if (w.lastReadingAt == null || now - w.lastReadingAt > alert.maxAgeMs) {
          w.aboveSince = null
          await clear(w, 'no fresh reading')
          return
        }
        const e = w.episode
        if (!e || e.stopped || isMuted() || e.times >= (alert.times ?? 1) || now < e.nextAt) return
        if (alert.dayOnly && !isDay(now)) return
        e.times += 1
        e.nextAt = now + (alert.durationSec + (alert.pauseSec ?? 60)) * 1000
        log(`${alert.name}: sounding (${e.times}/${alert.times ?? 1})`)
        await sound(alert)
      }

      const stop = async (why) => {
        const active = watch.filter((w) => w.episode && !w.episode.stopped)
        const testActive = Date.now() < testSoundingUntil
        if (active.length === 0 && !testActive) return false
        log(`stopped by ${why}`)
        active.forEach((w) => { w.episode.stopped = true })
        await silence()
        return true
      }

      for (const w of watch) {
        await mqtt.subscribe(w.alert.topic, async (payload) => {
          const value = payload?.state
          if (typeof value !== 'number' || !Number.isFinite(value)) return
          const now = Date.now()
          // A gap longer than maxAgeMs means the value was not seen to hold.
          if (w.lastReadingAt == null || now - w.lastReadingAt > w.alert.maxAgeMs) w.aboveSince = null
          w.lastReadingAt = now
          if (value > w.alert.above) {
            w.aboveSince ??= now
            // Confirmed only by a reading that is still above the limit once
            // confirmMs has passed, never by the clock alone.
            if (!w.episode && now - w.aboveSince >= w.alert.confirmMs) {
              log(`${w.alert.name} confirmed`)
              w.episode = { times: 0, nextAt: now, stopped: false }
            }
          } else {
            w.aboveSince = null
            await clear(w, `value ${value}`)
          }
          await evaluate(w)
        })
      }

      // A press is a change from false to true. The first message of each
      // button is its retained state, not a press.
      const buttonState = new Map()
      for (const topic of stopButtonTopics) {
        await mqtt.subscribe(topic, async (payload) => {
          if (typeof payload?.state !== 'boolean') return
          const before = buttonState.get(topic)
          buttonState.set(topic, payload.state)
          if (before === false && payload.state === true) await stop(topic)
        })
      }

      if (stopTopic) {
        await mqtt.subscribe(stopTopic, async (payload) => { if (payload) await stop('Home Assistant') })
      }

      if (test) {
        await mqtt.subscribe(test.topic, async (payload) => {
          if (!payload) return
          log('test sound')
          await sound(test)
          testSoundingUntil = soundingUntil
        })
      }

      if (mute) {
        let muteTimer = null
        const armMuteEnd = () => {
          clearTimeout(muteTimer)
          if (!isMuted()) return
          muteTimer = setTimeout(async () => {
            persistedCache.muteUntil = null
            log('mute ended')
            await publishMute()
            await Promise.all(watch.map(evaluate))
          }, persistedCache.muteUntil - Date.now())
        }
        await mqtt.subscribe(mute.commandTopic, async (payload) => {
          if (typeof payload?.state !== 'boolean') return
          persistedCache.muteUntil = payload.state ? Date.now() + mute.maxMs : null
          log(payload.state ? 'muted' : 'mute off')
          armMuteEnd()
          await publishMute()
          if (payload.state && isSounding()) await silence()
          if (!payload.state) await Promise.all(watch.map(evaluate))
        })
        if (persistedCache.muteUntil != null && !isMuted()) persistedCache.muteUntil = null
        armMuteEnd()
        await publishMute()
      }

      const alive = watchInputAge({
        inputs: ['siren'],
        maxAgeMs: aliveMaxAgeMs,
        onChange: (stale) => sendTelegram(name, stale
          ? `🔕 The hall siren has sent nothing for ${Math.round(aliveMaxAgeMs / 3600000)} h. Safety alerts may not sound. Check zigbee2mqtt and the siren.`
          : '🔔 The hall siren is back and sends again.')
      })
      await mqtt.subscribe(siren.stateTopic, (payload) => {
        const lastSeen = Date.parse(payload?.last_seen)
        alive.seen('siren', Number.isFinite(lastSeen) ? lastSeen : undefined)
      })

      setInterval(() => { watch.forEach(evaluate) }, CHECK_INTERVAL_MS).unref?.()
    }
  }
}
