const { watchInputAge } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')

const MIN = 60 * 1000
// Targets come in 0.1 °C steps; this keeps a change of exactly minChange
// from looking smaller because of float rounding.
const EPSILON = 1e-6
// Where the outdoor temperature in the status comes from
const MEAN = '24 h mean'
const MONTHLY = 'monthly average'

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const roundTo = (value, step) => Math.round(value / step) * step
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * A room thermostat for the heat pump (#1753). It sets the heat-pump
 * controller's water target (`targetTemp`) from the room temperature, the set
 * point from Home Assistant and the outdoor temperature. The controller keeps
 * its own start/stop band and compressor times.
 *
 * - Water target: the water the room needs at this outdoor temperature (from
 *   `model`: room = intercept + perWater × water + perOutdoor × outdoor), plus
 *   `roomGain` °C for each °C the room is under the set point (less when it is
 *   over), rounded to `waterStep` and kept within `minWater`..`maxWater`.
 * - A check runs every `checkMs`, not on each message. It writes only when the
 *   room and controller data are fresh, the controller is heating, the target
 *   moves by `minChange` or more, and the last write was `minWriteIntervalMs`
 *   ago. The first check that can write after a set point change does not
 *   wait for that time.
 * - Old or missing room data: no writes, so the controller keeps its last
 *   target; one log line and one Telegram message, and one each when it is back.
 * - Outdoor: the mean of the weather service's values of the last
 *   `outdoorMeanMs` (24 h), because the model is a fit on daily means and the
 *   hourly value made the target follow the day and night swing. A value is
 *   kept only when it is at most `outdoorMaxAgeMs` old on arrival, once per
 *   time, and over a restart. When the newest value is more than
 *   `outdoorHoldMs` old: the mean of the month from `outdoorMonthlyMeans`
 *   (the rules in docker/weather/CLAUDE.md). The weather comes from the
 *   internet, so the bot keeps working without it.
 * - A controller target the bot did not write (changed on the controller or
 *   in Home Assistant, or a write that did not arrive): one log line and one
 *   Telegram message for each change. Readings made within `writeSettleMs`
 *   after the bot's own write are not checked: they may still show the old
 *   target. The bot keeps its normal schedule and may change it again.
 * - Status (retained): set point, inputs, water target and a short state, after
 *   each check and each set point change.
 */
module.exports = (name, {
  roomTopic,
  outdoorTopic,
  controllerTopic,
  controllerWriteTopic,
  setTopic,
  statusTopic,
  defaultSetPoint = 21.5,
  minSetPoint = 16,
  maxSetPoint = 26,
  setPointStep = 0.5,
  model = { intercept: 11.5, perWater: 0.36, perOutdoor: 0.12 },
  roomGain = 2,
  waterStep = 0.5,
  minWater = 22,
  maxWater = 32,
  minChange = 1,
  checkMs = 10 * MIN,
  minWriteIntervalMs = 6 * 60 * MIN,
  roomMaxAgeMs = 150 * MIN,
  controllerMaxAgeMs = 15 * MIN,
  writeSettleMs = 15 * MIN,
  outdoorMaxAgeMs = 60 * MIN,
  outdoorMeanMs = 24 * 60 * MIN,
  outdoorHoldMs = 12 * 60 * MIN,
  // °C, January..December
  outdoorMonthlyMeans = [3.7, 5.0, 7.6, 12.3, 16.7, 22.8, 26.1, 25.3, 20.1, 14.0, 9.5, 5.2],
  telegramWebhookUrl,
  httpPost
}) => ({
  persistedCache: {
    version: 2,
    default: {
      setPoint: defaultSetPoint,
      // Lets the next check write before minWriteIntervalMs is over
      setPointChanged: false,
      lastWriteAt: null,
      // Fresh outdoor values of the last outdoorMeanMs: [{temperature, time}] (time in ms)
      outdoorSamples: [],
      // The last target the bot wrote, or before its first write the first one it saw
      knownTarget: null
    },
    // A new default (another set point in the config) keeps the stored values.
    // Only version 1 has `outdoor`, its last outdoor value: it is added to the
    // values of the mean. Version 1 did not keep the target it wrote, also
    // after a rollback to it, so the known target is taken again.
    migrate: ({ defaultState, state }) => {
      const { outdoor, ...rest } = state
      const migrated = { ...defaultState, ...rest }
      if (!Array.isArray(migrated.outdoorSamples)) migrated.outdoorSamples = []
      if ('outdoor' in state) {
        migrated.knownTarget = null
        if (isNumber(outdoor?.temperature) && isNumber(outdoor?.time) &&
          !migrated.outdoorSamples.some((sample) => sample.time === outdoor.time)) {
          migrated.outdoorSamples = [...migrated.outdoorSamples, { temperature: outdoor.temperature, time: outdoor.time }]
        }
      }
      return migrated
    }
  },

  start: ({ mqtt, persistedCache, isEnabled = () => true }) => {
    let room = null
    let controller = null
    let outdoorSource = null
    let notHeating = false

    const say = (message) => console.log(`[${name}] ${message}`)
    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost, isEnabled })

    const roomMinutes = Math.round(roomMaxAgeMs / MIN)
    const roomAge = watchInputAge({
      inputs: ['room'],
      maxAgeMs: roomMaxAgeMs,
      onChange: (stale) => {
        const target = controller ? `${controller.targetTemp} °C` : 'its last value'
        const message = stale
          ? `no living-room temperature for ${roomMinutes} min. The heat-pump water target stays at ${target} until it returns.`
          : 'living-room temperature is back. Normal control again.'
        say(message)
        alert(name, `${stale ? '⚠️' : '✅'} ${name}: ${message}`)
      }
    })

    const controllerMinutes = Math.round(controllerMaxAgeMs / MIN)
    const controllerAge = watchInputAge({
      inputs: ['controller'],
      maxAgeMs: controllerMaxAgeMs,
      onChange: (stale) => say(stale
        ? `no heat-pump controller data for ${controllerMinutes} min: no writes until it returns`
        : 'heat-pump controller data is back')
    })

    // The kept outdoor values without the ones older than outdoorMeanMs. The
    // persisted list is changed only when a value drops out, so it is not
    // saved on each check.
    const recentSamples = () => {
      const samples = persistedCache.outdoorSamples.filter((sample) => Date.now() - sample.time < outdoorMeanMs)
      if (samples.length !== persistedCache.outdoorSamples.length) persistedCache.outdoorSamples = samples
      return samples
    }

    const outdoorNow = () => {
      const samples = recentSamples()
      const newest = Math.max(...samples.map((sample) => sample.time))
      if (Date.now() - newest <= outdoorHoldMs) {
        const mean = samples.reduce((sum, sample) => sum + sample.temperature, 0) / samples.length
        return { temperature: Math.round(mean * 10) / 10, source: MEAN, sampleCount: samples.length }
      }
      return { temperature: outdoorMonthlyMeans[new Date().getMonth()], source: MONTHLY, sampleCount: 0 }
    }

    const outdoorMessage = ({ temperature, source, sampleCount }) => source === MEAN
      ? `outdoor temperature from the weather data again: ${temperature} °C, the mean of ${sampleCount} values`
      : `outdoor temperature from the monthly average: ${temperature} °C; no weather data for ${Math.round(outdoorHoldMs / (60 * MIN))} h`

    // A target the bot did not write. `madeAt` is the time of the reading.
    const checkTarget = (targetTemp, madeAt) => {
      const { knownTarget, lastWriteAt } = persistedCache
      // A reading made soon after a write (also a write by the version before)
      // may still show the old target
      if (lastWriteAt != null && madeAt - lastWriteAt < writeSettleMs) return
      if (knownTarget == null) {
        persistedCache.knownTarget = targetTemp
        return
      }
      if (Math.abs(targetTemp - knownTarget) <= EPSILON) return
      const message = `heat-pump water target is ${targetTemp} °C, not the ${knownTarget} °C this bot last wrote or saw: ` +
        'changed outside the bot, or its write did not arrive.' +
        (controller.mode === 'heating' ? ' The bot may change it again at its next write.' : '')
      say(message)
      alert(name, `⚠️ ${name}: ${message}`)
      persistedCache.knownTarget = targetTemp
    }

    const waterFor = (setPoint, roomTemp, outdoorTemp) => {
      const needed = (setPoint - model.intercept - model.perOutdoor * outdoorTemp) / model.perWater
      const water = needed + roomGain * (setPoint - roomTemp)
      return clamp(roundTo(water, waterStep), minWater, maxWater)
    }

    const evaluate = () => {
      const outdoor = outdoorNow()
      const roomFresh = roomAge.isFresh()
      const waterTarget = roomFresh ? waterFor(persistedCache.setPoint, room.temperature, outdoor.temperature) : null
      const state = !roomFresh ? 'room data old'
        : !controllerAge.isFresh() ? 'controller data old'
          : controller.mode !== 'heating' ? 'controller not heating'
            : 'ok'
      return { outdoor, waterTarget, state }
    }

    const publishStatus = ({ outdoor, waterTarget, state }) => {
      mqtt.publish(statusTopic, {
        setPoint: persistedCache.setPoint,
        roomTemp: room ? room.temperature : null,
        outdoorTemp: outdoor.temperature,
        outdoorSource: outdoor.source,
        outdoorSampleCount: outdoor.sampleCount,
        waterTarget,
        controllerTarget: controller ? controller.targetTemp : null,
        state
      }, { retain: true })
    }

    const check = () => {
      // A disabled bot gets no input and its publishes are dropped, so it must
      // not count a write it could not send.
      if (!isEnabled()) return
      const result = evaluate()
      const { outdoor, waterTarget, state } = result

      // Weather data at the start is normal, so only a change is logged then
      if (outdoor.source !== outdoorSource) {
        if (outdoorSource !== null || outdoor.source !== MEAN) say(outdoorMessage(outdoor))
        outdoorSource = outdoor.source
      }

      if (controllerAge.isFresh()) {
        const heating = controller.mode === 'heating'
        if (!heating && !notHeating) say(`heat-pump controller is not heating (mode ${controller.mode}): no writes`)
        if (heating && notHeating) say('heat-pump controller is heating again')
        notHeating = !heating
      }

      if (state === 'ok') {
        const now = Date.now()
        const { lastWriteAt, setPointChanged } = persistedCache
        const intervalOver = lastWriteAt == null || now - lastWriteAt >= minWriteIntervalMs
        const change = Math.abs(waterTarget - controller.targetTemp)
        if (change >= minChange - EPSILON && (intervalOver || setPointChanged)) {
          say(`water target ${controller.targetTemp} -> ${waterTarget}: set point ${persistedCache.setPoint}, ` +
            `room ${room.temperature}, outdoor ${outdoor.temperature} (${outdoor.source})` +
            (intervalOver ? '' : ', right after a set point change'))
          mqtt.publish(controllerWriteTopic, { targetTemp: waterTarget })
          persistedCache.lastWriteAt = now
          persistedCache.knownTarget = waterTarget
          // Until the next reading, so a quick set point change does not send
          // the same value again
          controller.targetTemp = waterTarget
        }
        // Only the first check that can write gets past the interval
        persistedCache.setPointChanged = false
      }

      publishStatus(result)
    }

    mqtt.subscribe(roomTopic, (payload) => {
      if (!isNumber(payload?.temperature)) return
      room = { temperature: payload.temperature }
      // zigbee2mqtt sends its stored state again after a restart, so the
      // value is as old as its last_seen, not as the message.
      const lastSeen = payload.last_seen
      const madeAt = typeof lastSeen === 'number' ? lastSeen : Date.parse(lastSeen)
      roomAge.seen('room', Number.isFinite(madeAt) ? madeAt : undefined)
    })

    mqtt.subscribe(controllerTopic, (payload) => {
      if (!isNumber(payload?.targetTemp)) return
      controller = { targetTemp: payload.targetTemp, mode: payload.mode }
      controllerAge.seen('controller', payload._tz)
      checkTarget(payload.targetTemp, isNumber(payload._tz) ? payload._tz : Date.now())
    })

    // Only a fresh value is kept. The message is retained and comes again
    // after a reconnect, so a time already kept is skipped.
    mqtt.subscribe(outdoorTopic, (payload) => {
      const time = Date.parse(payload?.time)
      if (!isNumber(payload?.temperature) || !Number.isFinite(time)) return
      if (Date.now() - time > outdoorMaxAgeMs) return
      const samples = recentSamples()
      if (samples.some((sample) => sample.time === time)) return
      persistedCache.outdoorSamples = [...samples, { temperature: payload.temperature, time }]
    })

    mqtt.subscribe(setTopic, (payload) => {
      if (!isNumber(payload?.setPoint)) {
        say('ignored a set point that is not a number')
        return
      }
      const setPoint = clamp(roundTo(payload.setPoint, setPointStep), minSetPoint, maxSetPoint)
      if (setPoint !== persistedCache.setPoint) {
        say(`set point ${persistedCache.setPoint} -> ${setPoint}`)
        persistedCache.setPoint = setPoint
        persistedCache.setPointChanged = true
      }
      publishStatus(evaluate())
    })

    setInterval(check, checkMs)
  }
})
