const { watchInputAge } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')

const MIN = 60 * 1000
// Targets come in 0.1 °C steps; this keeps a change of exactly minChange
// from looking smaller because of float rounding.
const EPSILON = 1e-6

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
 * - Outdoor, by the rules in docker/weather/CLAUDE.md: the weather service's
 *   value while it is up to `outdoorMaxAgeMs` old; then that last value (kept
 *   over a restart) while it is up to `outdoorHoldMs` old; then the mean of the
 *   month from `outdoorMonthlyMeans`. The weather comes from the internet, so
 *   the bot keeps working without it.
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
  minWriteIntervalMs = 3 * 60 * MIN,
  roomMaxAgeMs = 90 * MIN,
  controllerMaxAgeMs = 15 * MIN,
  outdoorMaxAgeMs = 60 * MIN,
  outdoorHoldMs = 12 * 60 * MIN,
  // °C, January..December
  outdoorMonthlyMeans = [3.7, 5.0, 7.6, 12.3, 16.7, 22.8, 26.1, 25.3, 20.1, 14.0, 9.5, 5.2],
  telegramWebhookUrl,
  httpPost
}) => ({
  persistedCache: {
    version: 1,
    default: {
      setPoint: defaultSetPoint,
      // Lets the next check write before minWriteIntervalMs is over
      setPointChanged: false,
      lastWriteAt: null,
      // The last fresh outdoor value: {temperature, time} (time in ms)
      outdoor: null
    },
    // A new default (another set point in the config) keeps the stored values
    migrate: ({ defaultState, state }) => ({ ...defaultState, ...state })
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

    const outdoorNow = () => {
      const last = persistedCache.outdoor
      const age = last ? Date.now() - last.time : Infinity
      if (age <= outdoorMaxAgeMs) return { temperature: last.temperature, time: last.time, source: 'weather' }
      if (age <= outdoorHoldMs) return { temperature: last.temperature, time: last.time, source: 'last value' }
      return { temperature: outdoorMonthlyMeans[new Date().getMonth()], source: 'monthly average' }
    }

    const outdoorMessage = ({ temperature, time, source }) => {
      if (source === 'weather') return `outdoor temperature from the weather data again: ${temperature} °C`
      if (source === 'last value') {
        return `outdoor temperature from the last value: ${temperature} °C at ${new Date(time).toISOString()}; the weather data is old or missing`
      }
      return `outdoor temperature from the monthly average: ${temperature} °C; no weather data for ${Math.round(outdoorHoldMs / (60 * MIN))} h`
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
        if (outdoorSource !== null || outdoor.source !== 'weather') say(outdoorMessage(outdoor))
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
    })

    // Only a fresh value is kept, and never one older than the kept one
    mqtt.subscribe(outdoorTopic, (payload) => {
      const time = Date.parse(payload?.time)
      if (!isNumber(payload?.temperature) || !Number.isFinite(time)) return
      const last = persistedCache.outdoor
      if (Date.now() - time > outdoorMaxAgeMs || (last && time < last.time)) return
      persistedCache.outdoor = { temperature: payload.temperature, time }
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
