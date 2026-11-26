const { watchInputAge, DEFAULT_MAX_INPUT_AGE_MS } = require('../lib/input-age')
const telegramAlert = require('../lib/telegram-alert')
const boilerTank = require('../lib/boiler-tank')
const boilerPlan = require('../lib/boiler-plan')

// The longest vacation_until: 60 days (#1756)
const MAX_VACATION_UNTIL_MS = 60 * 24 * 60 * 60 * 1000

const MINUTES_PER_DAY = 24 * 60

const minutesOfDay = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}

const minutesMod = (minutes) => (minutes % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY

// Returns a function that places a moment in the EVN night tariff table:
// the zone of its month and the minutes since that zone started. The zone
// hours are on the local wall clock of `timeZone`, so the month and time are
// read in that zone, never with a fixed UTC offset that would be an hour off
// for half of the year.
const tariffClock = ({ timeZone, zones }) => {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  })
  return (ms) => {
    const parts = Object.fromEntries(clock.formatToParts(ms).map(({ type, value }) => [type, Number(value)]))
    const zone = zones.find(({ months }) => months.includes(parts.month))
    if (!zone) return null
    const start = minutesOfDay(zone.start)
    return {
      sinceZoneStart: minutesMod(parts.hour * 60 + parts.minute - start),
      zoneLength: minutesMod(minutesOfDay(zone.end) - start)
    }
  }
}

// The night tariff periods of one moment:
// - hold: from `holdBeforeMinutes` before the zone starts until
//   `marginMinutes` after it (#1740);
// - dayTopUp: the `dayTopUpMinutes` just before the hold (0 = none);
// - nightBoost: from the end of the hold until the zone ends.
const tariffPeriods = ({ holdBeforeMinutes, marginMinutes, ...table }, dayTopUpMinutes = 0) => {
  const place = tariffClock(table)
  return (ms) => {
    const at = place(ms)
    if (!at) return { hold: false, dayTopUp: false, nightBoost: false, minutesToNightBoost: null }
    const { sinceZoneStart, zoneLength } = at
    return {
      hold: minutesMod(sinceZoneStart + holdBeforeMinutes) < holdBeforeMinutes + marginMinutes,
      dayTopUp: minutesMod(sinceZoneStart + holdBeforeMinutes + dayTopUpMinutes) < dayTopUpMinutes,
      nightBoost: sinceZoneStart >= marginMinutes && sinceZoneStart < zoneLength,
      // Minutes until the next night boost period starts (0 inside it)
      minutesToNightBoost: minutesMod(marginMinutes - sinceZoneStart)
    }
  }
}

module.exports = (name, {
  temperatureTopTopic,
  temperatureBottomTopic,
  solarTemperatureTopic,
  ambientTemperatureTopic,
  solarCirculationTopic,
  boilerRelayTopic,
  controlModeTopic,
  controlModeStatusTopic,
  automationStatusTopic,
  manualOverrideExpiry = 24 * 60 * 60 * 1000, // 24 hours default
  // Temperature thresholds
  comfortMin = 50,
  emergencyMin = 45,
  maxSafe = 70,
  solarAdvantageMin = 5,
  solarDisadvantageMax = -3,
  hysteresis = 3,
  nightTariff,
  // The tank top reaches the taps unmixed while there is no thermostatic
  // mixing valve (#1473). The automatic rules (top-up, night boost, draw)
  // never heat the top above this, whatever their own targets say.
  hotWaterLimit = 55,
  // The `boost` and `manual_on` modes heat the whole tank (#1976): they heat
  // while the bottom is under boostBottomTarget, and never let the top reach
  // boostTopLimit. Both in °C.
  boostBottomTarget = 50,
  boostTopLimit = 60,
  // Night tariff extras (#1911), all off unless set; they need `nightTariff`.
  // nightBoostTarget: from the end of the hold to the end of the night zone,
  // heat the top to this (°C).
  nightBoostTarget,
  // dayTopUp: { minutesBeforeHold, target }: in the minutes just before the
  // hold, heat the top to `target` (°C), at day price.
  dayTopUp,
  // Start on a draw: when the bottom reading falls by `drawDropK` K within
  // `drawWindowMinutes`, start the element and heat the top to the target in
  // force (the top-up or boost target, else comfortMin + hysteresis).
  drawDropK,
  drawWindowMinutes = 10,
  // A draw that has not started the element within this time is dropped.
  drawLatchMinutes = 30,
  // Load stagger: the element does not start while the dishwasher runs or the
  // main meter's recent mean power is high. Both gates are off without topics.
  dishwasherTopic,
  mainPowerTopic,
  dishwasherOnW = 10,
  dishwasherHoldMs = 10 * 60 * 1000,
  mainPowerCapW = 6000,
  mainPowerMeanMs = 5 * 60 * 1000,
  maxLoadInputAgeMs = 10 * 60 * 1000,
  maxInputAgeMs = DEFAULT_MAX_INPUT_AGE_MS,
  // Contactor feedback (#1912): the contactor status topic gives the real
  // state of the element. Without it the controller takes its own last
  // command as the state, as before.
  contactorStatusTopic,
  // An ON that the controller did not send is kept until the top reaches the
  // stop target in force, or for at most this long.
  externalOnMaxMs = 2 * 60 * 60 * 1000,
  // After an OFF that the controller did not send, no restart for this long.
  externalOffHoldMs = 30 * 60 * 1000,
  // The longest `boost`.
  boostDurationMs = 2 * 60 * 60 * 1000,
  // A status that matches a command sent within this time is that command
  // coming back. A contactor that still differs after it gets the command again.
  commandConfirmMs = 60 * 1000,
  // When the first status goes out after start
  startupStatusDelayMs = 10 * 1000,
  // Baths ready (#1984), only computed and published, never used to switch
  // the element. A bath is bathLitres of water at bathTempC at the tap.
  bathLitres = 65,
  bathTempC = 40,
  // Cold water °C by month, January first
  coldWaterByMonth = [11.6, 9.8, 13.3, 12.9, 17.2, 19.9, 23.0, 23.9, 19.1, 17.1, 14.6, 13.1],
  // Mean element power (kW) by the water temperature at the element: the
  // first row with the temperature under `belowC`; the last row has none.
  elementPowerByTempKw = [
    { belowC: 30, kw: 2.6 },
    { belowC: 35, kw: 2.1 },
    { belowC: 40, kw: 1.55 },
    { belowC: 45, kw: 1.05 },
    { kw: 0.75 }
  ],
  // The layer geometry of the tank model; see lib/boiler-tank.js
  tankModel = boilerTank.DEFAULT_TANK,
  // The month of the cold water table is taken on this wall clock
  timeZone = 'Europe/Sofia',
  // The name of the boost button in the sentence
  boostButtonName = 'Загрей целия бойлер',
  // The evening plan (#1985), off unless set; it needs `nightTariff`. When
  // on, it replaces dayTopUp and nightBoostTarget: the element heats only
  // the hot water the coming evening is missing. Fields: see
  // config/automations/boiler-controller-config.js and the docs.
  eveningPlan,
  telegramWebhookUrl,
  httpPost,
  verbose
}) => ({
  persistedCache: {
    version: 1,
    default: {
      controlMode: 'automatic',
      manualOverrideExpires: null,
      externalOnSince: null,
      // The evening plan (#1985): the baths used per evening
      // ({ 'YYYY-MM-DD': baths }) and the "Бани довечера" value
      // ({ date, baths } or null).
      eveningBaths: {},
      eveningOverride: null
    },
    migrate: ({ version, defaultState, state }) => {
      return {
        ...state,
        eveningBaths: state.eveningBaths ?? defaultState.eveningBaths,
        eveningOverride: state.eveningOverride ?? defaultState.eveningOverride
      }
    }
  },

  start: ({ mqtt, persistedCache, isEnabled }) => {
    let currentState = {
      temperatureTop: null,
      temperatureBottom: null,
      solarTemperature: null,
      ambientTemperature: null,
      solarCirculation: false,
      // The controller's own last decision. The real state of the element is
      // heaterOn() below.
      decision: false,
      controlMode: 'automatic',
      manualOverrideExpires: null,
      lastDecision: null,
      lastDecisionReason: null,
      // The result of the last mode command (#1975), in memory only
      lastCommand: null
    }

    // Load persistent state from cache
    const loadState = () => {
      // Restore control mode
      currentState.controlMode = persistedCache.controlMode || 'automatic'

      // Only restore manual override expiry if not expired
      if (persistedCache.manualOverrideExpires && Date.now() < persistedCache.manualOverrideExpires) {
        currentState.manualOverrideExpires = persistedCache.manualOverrideExpires
        if (verbose) {
          console.log(`[${name}] restored control mode: ${currentState.controlMode} expires at ${new Date(persistedCache.manualOverrideExpires)}`)
        }
      } else if (currentState.controlMode !== 'automatic') {
        // Manual mode expired, reset to automatic
        currentState.controlMode = 'automatic'
        persistedCache.controlMode = 'automatic'
        if (verbose) {
          console.log(`[${name}] manual override expired, reset to automatic mode`)
        }
      }
    }

    const saveState = () => {
      persistedCache.controlMode = currentState.controlMode
      persistedCache.manualOverrideExpires = currentState.manualOverrideExpires
      persistedCache.externalOnSince = externalOn ? externalOn.since : null
    }

    // Contactor feedback (#1912). The controller's own commands come back on
    // the status topic too; a change that matches a recent command is ours,
    // any other change was made by someone else (the Home Assistant switch,
    // another script, the relay module).
    const startedAt = Date.now()
    let contactorState = null // the last status, null until one arrives
    let commanded = null // { state, at } of the last command sent
    // The relay acts on a command within a poll or two; a reading this long
    // after a command shows its result.
    const COMMAND_SETTLE_MS = 10 * 1000
    // Commands of the last commandConfirmMs that no reading has answered yet.
    let recentCommands = [] // { state, at }
    let externalOn = null // { since }: an outside ON being kept
    let externalOff = null // { since }: an outside OFF being respected
    const commandPending = (state) => commanded !== null && commanded.state === state &&
      Date.now() - commanded.at < commandConfirmMs
    // A status change is ours when a recent command not answered yet asked
    // for it: after a quick ON then OFF, the ON reading may arrive after the
    // OFF command. The reading answers that command and all older ones.
    const answersCommand = (state) => {
      const now = Date.now()
      recentCommands = recentCommands.filter(({ at }) => now - at < commandConfirmMs)
      const index = recentCommands.findIndex((command) => command.state === state)
      if (index === -1) return false
      recentCommands = recentCommands.slice(index + 1)
      return true
    }
    // The state the rules work with: the contactor status, or a command just
    // sent that has not come back yet. Without feedback, the last decision.
    const heaterOn = () => {
      if (!contactorStatusTopic || contactorState === null) return currentState.decision
      if (commanded !== null && commanded.state !== contactorState && commandPending(commanded.state)) return commanded.state
      return contactorState
    }
    // After a restart the element may be running. No command is sent until
    // the contactor state is known (the status is retained, so it comes at
    // once), or until commandConfirmMs has passed without it.
    const waitingForContactor = () => Boolean(contactorStatusTopic) && contactorState === null &&
      Date.now() - startedAt < commandConfirmMs

    const capped = (target) => Number.isFinite(target) ? Math.min(target, hotWaterLimit) : null
    // The evening plan (#1985). Its limits are capped like every other
    // automatic target; without both limits it stays off.
    const planNightLimit = nightTariff && eveningPlan ? capped(eveningPlan.nightLimit) : null
    const planDayLimit = nightTariff && eveningPlan ? capped(eveningPlan.dayLimit) : null
    const planOn = planNightLimit !== null && planDayLimit !== null
    const boostTarget = nightTariff && !planOn ? capped(nightBoostTarget) : null
    const topUpTarget = nightTariff && dayTopUp && !planOn ? capped(dayTopUp.target) : null
    const periodsAt = nightTariff
      ? tariffPeriods(nightTariff, topUpTarget === null ? 0 : dayTopUp.minutesBeforeHold)
      : () => ({ hold: false, dayTopUp: false, nightBoost: false })

    // The top-up or boost in force at a moment, or null. With the evening
    // plan: the plan's night window (the night boost period) or its day
    // window (from the planned start to the hold).
    const heatWindowAt = (ms) => {
      const periods = periodsAt(ms)
      if (planOn) {
        if (periods.nightBoost) return { reason: 'plan_night', target: planNightLimit }
        if (planDayOpen(ms, periods)) return { reason: 'plan_day', target: planDayLimit }
        return null
      }
      if (periods.dayTopUp && topUpTarget !== null) return { reason: 'day_top_up', target: topUpTarget }
      if (periods.nightBoost && boostTarget !== null) return { reason: 'night_boost', target: boostTarget }
      return null
    }
    // The first start in a window heats to its target even when the top is
    // in the hysteresis band below it: when the hold ends at 22:15, a top of
    // 54 °C still gets its boost, so the element runs when the evening draw
    // comes. After the target is reached once the usual hysteresis applies.
    let lastWindowReason = null
    let windowArmed = false

    // The evening plan (#1985). The plan is for the evening of the local
    // date: from midnight to midnight it plans that evening, so the night
    // after midnight heats for the coming evening.
    const {
      marginBaths = 1,
      eveningStart = '19:30',
      startMarginMinutes = 15,
      startBaths = 0.25,
      measureFrom = '18:00',
      standbyW = 40,
      boilerMeterTopic,
      sameWeekdays = 4,
      historyDays = 56,
      maxBaths = 15,
      bathsBySeason,
      overrideSetTopic,
      overrideStatusTopic,
      overrideMaxBaths = 10
    } = eveningPlan || {}
    const localAt = boilerPlan.localClock(timeZone)
    const eveningStartMin = boilerPlan.minutesOfDay(eveningStart)
    const measureFromMin = boilerPlan.minutesOfDay(measureFrom)
    const startLitres = startBaths * bathLitres
    const round1 = (x) => Math.round(x * 10) / 10
    const round2 = (x) => Math.round(x * 100) / 100

    // The stored history, or nothing when it is broken
    const history = () => {
      const h = persistedCache.eveningBaths
      return h !== null && typeof h === 'object' && !Array.isArray(h) ? h : {}
    }
    const overrideFor = (date) => {
      const o = persistedCache.eveningOverride
      return o && o.date === date && boilerPlan.validBaths(o.baths, overrideMaxBaths) ? o.baths : null
    }
    // The need of the evening of `clock`: the "Бани довечера" value, the
    // learned mean, or the season table. Never "no need": a broken history
    // falls back to the table.
    const needFor = (clock) => {
      const override = overrideFor(clock.date)
      if (override !== null) return { need: override, source: 'override' }
      const learned = boilerPlan.learnedNeed(history(), clock.date, { count: sameWeekdays, maxDays: historyDays, maxBaths })
      if (learned !== null) return { need: learned, source: 'history' }
      const season = boilerPlan.seasonNeed(bathsBySeason, clock.month, clock.weekday)
      if (season !== null) return { need: season, source: 'season' }
      return { need: null, source: 'none' }
    }

    // The plan now: the target, the litres ready, the shortfall and the
    // planned start of the day-price heating. Null while the boiler
    // readings are old or missing. The model is slow, so its result is kept
    // while its inputs stay the same.
    let planMemo = { key: null, value: null }
    const planAt = (ms) => {
      if (!planOn) return null
      const clock = localAt(ms)
      const top = currentState.temperatureTop
      const bottom = currentState.temperatureBottom
      if (temperatures.isStale() || !Number.isFinite(top) || !Number.isFinite(bottom)) return null
      const { need, source } = needFor(clock)
      const key = [clock.date, top, bottom, need, source].join('|')
      if (planMemo.key !== key) {
        const cold = boilerTank.coldWaterAt(coldWaterByMonth, ms, timeZone)
        const profile = boilerTank.gradualProfile(bottom, top, cold, tankModel)
        const usable = boilerTank.usableLitres(profile, cold, bathTempC, tankModel)
        // What the tank holds when the top is at the day limit all the way down
        const capacity = boilerTank.usableLitres(boilerTank.gradualProfile(planDayLimit, planDayLimit, cold, tankModel), cold, bathTempC, tankModel)
        // Without any need (a broken table) the plan fills the tank
        const targetLitres = need === null ? capacity : (need + marginBaths) * bathLitres
        const shortfallLitres = Math.max(0, targetLitres - usable)
        // The day-price heating stores at most what the tank can hold; the
        // rest is heated during the baths.
        const dayLitres = Math.max(0, Math.min(targetLitres, capacity) - usable)
        const heatMinutes = dayLitres > 0
          ? boilerPlan.minutesToStore({ profile, cold, bathTempC, litres: usable + dayLitres, powerTable: elementPowerByTempKw, topLimit: planDayLimit, model: tankModel })
          : 0
        planMemo = {
          key,
          value: {
            date: clock.date,
            need,
            needSource: source,
            usable,
            capacity,
            targetLitres,
            shortfallLitres,
            heatMinutes,
            // Local minutes of the day-price start, or null when no start is planned
            plannedStartMin: shortfallLitres >= startLitres
              ? (dayLitres > 0 ? eveningStartMin - heatMinutes - startMarginMinutes : eveningStartMin)
              : null
          }
        }
      }
      return planMemo.value
    }

    // The day window opens at the planned start and then stays open until
    // the hold, so a plan that moves a little later does not stop and start
    // the element.
    let dayOpenDate = null
    const planDayOpen = (ms, periods) => {
      if (periods.hold || periods.nightBoost) return false
      const clock = localAt(ms)
      if (dayOpenDate === clock.date) return true
      const plan = planAt(ms)
      return plan !== null && plan.plannedStartMin !== null && clock.minutes >= plan.plannedStartMin
    }

    // Draw detection: the bottom readings of the last `drawWindowMinutes`.
    // The bottom sensor sits inside the lower serpentine, low in the tank,
    // where the cold water of a draw comes in first.
    const drawWindowMs = drawWindowMinutes * 60 * 1000
    let bottomReadings = [] // { at, temp }
    // The time of the last detection, or null. Kept until the element has
    // heated the top to the target (see decideAutomatic).
    let drawSeenAt = null
    const bottomSeen = (temp, at) => {
      if (!Number.isFinite(drawDropK)) return
      bottomReadings.push({ at, temp })
      const newest = Math.max(...bottomReadings.map(r => r.at))
      bottomReadings = bottomReadings.filter(r => r.at >= newest - drawWindowMs)
      const highest = Math.max(...bottomReadings.map(r => r.temp))
      // The readings have one decimal; the small slack keeps 47.6 -> 44.6
      // a fall of 3 K in floating point.
      if (highest - temp >= drawDropK - 1e-9) {
        drawSeenAt = at
        // A new detection needs a new fall from here, so one long draw does
        // not latch again on every reading.
        bottomReadings = [{ at, temp }]
        if (verbose) console.log(`[${name}] draw detected: bottom ${highest} -> ${temp}°C within ${drawWindowMinutes} min`)
      }
    }

    // Use configured topics (with fallbacks for backward compatibility)
    const finalControlModeStatusTopic = controlModeStatusTopic || controlModeTopic.replace('/set', '/status')
    const finalAutomationStatusTopic = automationStatusTopic || `homy/automation/${name}/status`

    // Load inputs. Times are the message's own `_tz` (the time of the reading),
    // or now when it has none. A time in the future counts as now. A reading without a numeric field is ignored.
    const readingTime = (payload) => typeof payload?._tz === 'number' ? Math.min(payload._tz, Date.now()) : Date.now()
    let mainReadings = [] // { at, watts } within the mean window
    let newestMainAt = null
    let lastDishwasherLoadAt = null
    let newestDishwasherAt = null

    const loadInputs = () => {
      const now = Date.now()
      // The window ends at the newest reading, so a short silence keeps the mean.
      if (newestMainAt !== null) mainReadings = mainReadings.filter(({ at }) => at >= newestMainAt - mainPowerMeanMs)
      // Ignored when there is no reading or the newest is too old: a dead meter must not block.
      const capIgnored = !mainPowerTopic || newestMainAt === null ||
        now - newestMainAt > maxLoadInputAgeMs
      const mean = mainReadings.length
        ? mainReadings.reduce((sum, { watts }) => sum + watts, 0) / mainReadings.length
        : null
      const dishwasherRunning = Boolean(dishwasherTopic) && newestDishwasherAt !== null &&
        now - newestDishwasherAt <= maxLoadInputAgeMs &&
        lastDishwasherLoadAt !== null && now - lastDishwasherLoadAt <= dishwasherHoldMs
      return {
        mainPowerMeanW: mean === null ? null : Math.round(mean),
        dishwasherRunning,
        capIgnored,
        capExceeded: !capIgnored && mean >= mainPowerCapW
      }
    }
    const loadStatus = () => {
      const { mainPowerMeanW, dishwasherRunning, capIgnored } = loadInputs()
      return { mainPowerMeanW, dishwasherRunning, capIgnored }
    }

    // Reasons that must start the element whatever the load. Only the real
    // low-top emergency; the overheat shut-off and the manual and vacation
    // modes never reach the gate (they are not starts by an automatic rule).
    const LOAD_EXEMPT_REASONS = ['emergency_heating_top_cold']

    // The one place the gates apply: an automatic rule that would switch the
    // element on while it is off. A running element is never stopped here.
    const gateStart = (result) => {
      if (!result.decision || heaterOn() || LOAD_EXEMPT_REASONS.includes(result.reason)) return result
      const { dishwasherRunning, capExceeded } = loadInputs()
      if (dishwasherRunning) return { decision: false, reason: 'load_wait_dishwasher' }
      if (capExceeded) return { decision: false, reason: 'load_wait_main_power' }
      return result
    }

    // Decide again only when a load reading changes which gate blocks.
    let lastGateKey = null
    const gateKey = () => {
      const { dishwasherRunning, capExceeded } = loadInputs()
      return `${dishwasherRunning}/${capExceeded}`
    }
    const loadChanged = () => {
      const key = gateKey()
      if (key === lastGateKey) return
      lastGateKey = key
      updateHeaterState()
    }

    const publishControlModeStatus = () => {
      mqtt.publish(finalControlModeStatusTopic, {
        mode: currentState.controlMode,
        manualOverrideExpires: currentState.manualOverrideExpires,
        lastCommand: currentState.lastCommand
      })
    }

    // Keeps the result of a mode command for the mode status (#1975), so
    // any client that sends a command can see what became of it and why.
    // result: 'applied' or 'refused'. reason: 'ok', 'top_at_limit' (the top
    // is at or above boostTopLimit), 'bottom_at_target' (the bottom is at or
    // above boostBottomTarget), 'invalid_until' or 'unknown_mode'.
    const commandResult = (mode, result, reason) => {
      currentState.lastCommand = {
        // A mode that is not a text is not kept; a long one is cut
        mode: typeof mode === 'string' ? mode.slice(0, 64) : null,
        result,
        reason,
        top: currentState.temperatureTop,
        bottom: currentState.temperatureBottom,
        limit: boostTopLimit,
        bottomTarget: boostBottomTarget,
        at: Date.now()
      }
    }
    const refuseCommand = (mode, reason) => {
      commandResult(mode, 'refused', reason)
      publishControlModeStatus()
    }

    const backToAutomatic = (why) => {
      currentState.controlMode = 'automatic'
      currentState.manualOverrideExpires = null
      saveState()
      publishControlModeStatus()
      if (verbose) console.log(`[${name}] ${why}, resuming automatic control`)
    }

    const endExternalOn = (why) => {
      externalOn = null
      saveState()
      if (verbose) console.log(`[${name}] outside ON ends: ${why}`)
    }

    // Why boost and manual_on cannot heat now (#1976), or null: the top at
    // boostTopLimit wins over the bottom at boostBottomTarget.
    const boostLimitReason = (top, bottom) => {
      if (top !== null && top >= boostTopLimit) return 'top_at_limit'
      if (bottom !== null && bottom >= boostBottomTarget) return 'bottom_at_target'
      return null
    }

    const makeDecision = () => {
      const now = Date.now()

      // Check if a manual mode has expired
      if (currentState.controlMode !== 'automatic' &&
        currentState.manualOverrideExpires && now >= currentState.manualOverrideExpires) {
        backToAutomatic(`${currentState.controlMode} mode expired`)
      }

      const top = currentState.temperatureTop
      const bottom = currentState.temperatureBottom
      const stale = temperatures.isStale()
      const overheated = top !== null && top >= maxSafe
      const atLimit = top !== null && top >= hotWaterLimit
      const expires = ` (expires: ${new Date(currentState.manualOverrideExpires)})`

      // An outside OFF is the newest order (a mode command ends it): no rule
      // and no mode starts the element again for externalOffHoldMs.
      if (externalOff && now - externalOff.since >= externalOffHoldMs) externalOff = null
      if (externalOff) return { decision: false, reason: 'external_off' }

      // An outside ON is kept until the top reaches the stop target in force,
      // for at most externalOnMaxMs. The night hold, the load gates and the
      // modes do not stop it; only maxSafe, hotWaterLimit and old inputs do.
      if (externalOn) {
        const target = heatWindowAt(now)?.target ?? comfortMin + hysteresis
        if (stale) endExternalOn('no fresh temperature')
        else if (overheated) endExternalOn(`top ${top}°C at maxSafe`)
        else if (top !== null && top >= target) endExternalOn(`top ${top}°C reached ${target}°C`)
        else if (atLimit) {
          // Only with a stop target above the limit. The usual rules could
          // keep a running element on here, so this stops it.
          endExternalOn(`top ${top}°C at hotWaterLimit`)
          return { decision: false, reason: 'hot_water_limit' }
        }
        else if (now - externalOn.since >= externalOnMaxMs) endExternalOn('time limit')
        else return { decision: true, reason: 'external_on' }
      }

      const mode = currentState.controlMode
      if (mode !== 'automatic') {
        // A draw seen before a manual or vacation mode is old news after it.
        drawSeenAt = null
      }

      // boost: heat the whole tank now, whatever the night hold and the load
      // gates say (#1976): until the bottom reaches boostBottomTarget, but
      // never the top to boostTopLimit; then go back to automatic. Old
      // readings and maxSafe stop it first.
      if (mode === 'boost') {
        if (stale) return { decision: false, reason: 'input_stale' }
        const done = overheated ? 'top_at_max_safe' : boostLimitReason(top, bottom)
        if (!done) return { decision: true, reason: 'manual_boost' }
        backToAutomatic(`boost done (${done}): top ${top}°C, bottom ${bottom}°C`)
      }

      if (mode === 'manual_on') {
        // The same limits as boost (#1976): on while the bottom is under
        // boostBottomTarget, never with the top at boostTopLimit or maxSafe.
        // Once off it starts again when both are hysteresis under them. Old
        // readings do not stop it (#1743): the limits use the last reading.
        if (overheated) return { decision: false, reason: 'safety_shutoff_overheated' }
        const band = heaterOn() ? 0 : hysteresis
        if ((top !== null && top >= boostTopLimit - band) || (bottom !== null && bottom >= boostBottomTarget - band)) {
          return { decision: false, reason: `manual_on_limit_reached${expires}` }
        }
        return { decision: true, reason: `manual_on${expires}` }
      }

      if (mode === 'manual_off' || mode.startsWith('vacation_')) {
        return { decision: false, reason: `${mode}${expires}` }
      }

      if (mode !== 'automatic' && mode !== 'boost') {
        return { decision: false, reason: `unknown_mode${expires}` }
      }

      return gateStart(decideAutomatic())
    }

    const decideAutomatic = () => {
      const now = Date.now()

      const heatWindow = heatWindowAt(now)
      if ((heatWindow?.reason ?? null) !== lastWindowReason) {
        lastWindowReason = heatWindow?.reason ?? null
        windowArmed = Boolean(heatWindow)
      }
      // Reaching the target ends the first-start exception, whatever rule
      // decides below.
      if (heatWindow && currentState.temperatureTop !== null && currentState.temperatureTop >= heatWindow.target) {
        windowArmed = false
      }

      // A reader that stops leaves the last temperatures here, and heating on
      // them could run the element with no real reading (#1743).
      if (temperatures.isStale()) {
        return { decision: false, reason: 'input_stale' }
      }

      const { temperatureTop, temperatureBottom, solarTemperature, solarCirculation } = currentState

      // Safety checks first
      if (temperatureTop !== null && temperatureTop >= maxSafe) {
        return { decision: false, reason: 'safety_shutoff_overheated' }
      }

      // Emergency heating - temperature too low
      if (temperatureTop !== null && temperatureTop < emergencyMin) {
        return { decision: true, reason: 'emergency_heating_top_cold' }
      }

      if (temperatureBottom !== null && temperatureBottom < emergencyMin) {
        return { decision: true, reason: 'emergency_heating_bottom_cold' }
      }

      // The top the draw rule heats to now.
      const target = heatWindow ? heatWindow.target : comfortMin + hysteresis
      // A draw ends when the element has heated the top to the target. A draw
      // seen while the top is still at the target waits for the top to fall
      // under it (the top is the last to cool), but at most drawLatchMinutes
      // while the element is off: a start the load gates held back that long
      // is not a draw start any more.
      if (drawSeenAt !== null && temperatureTop !== null) {
        if (heaterOn() && temperatureTop >= target) drawSeenAt = null
        else if (!heaterOn() && now - drawSeenAt > drawLatchMinutes * 60 * 1000) drawSeenAt = null
      }
      const drawStart = drawSeenAt !== null && temperatureTop !== null && temperatureTop < target

      // Night tariff: no heating in the last part of the day zone, so the
      // element tops the tank up in the cheaper night zone instead. A top
      // under the floor still heats, up to the floor plus the hysteresis.
      // A draw in the hold still starts the element (#1976): the evening
      // baths fall in the hold. The load gates apply to it.
      const holdFrom = nightTariff && nightTariff.floor + (heaterOn() ? hysteresis : 0)
      if (temperatureTop !== null && periodsAt(now).hold && temperatureTop >= holdFrom) {
        if (drawStart) return { decision: true, reason: 'draw_heating' }
        return { decision: false, reason: 'night_tariff_hold' }
      }

      // Comfort heating
      if (temperatureTop !== null && temperatureTop < comfortMin) {
        return { decision: true, reason: 'comfort_heating_insufficient' }
      }

      // Solar heating considerations
      if (temperatureTop !== null && solarTemperature !== null) {
        const solarAdvantage = solarTemperature - temperatureTop

        // Solar heating is very effective
        if (solarAdvantage >= solarAdvantageMin && solarCirculation) {
          return { decision: false, reason: 'solar_priority_available' }
        }

        // Solar heating is insufficient
        if (solarAdvantage <= solarDisadvantageMax) {
          return { decision: true, reason: 'solar_insufficient_boost_needed' }
        }
      }

      // Start on a draw, before the top cools: the element is then already
      // running while the tank empties (#1911). The load gates apply.
      if (drawStart) {
        return { decision: true, reason: 'draw_heating' }
      }

      // Day-zone top-up before the hold and night-zone boost after it: heat
      // the top to the window's target, with the hysteresis below it.
      if (heatWindow && temperatureTop !== null) {
        if (heatWindow.reason === 'plan_day') dayOpenDate = localAt(now).date
        if (temperatureTop >= heatWindow.target) {
          return { decision: false, reason: `${heatWindow.reason}_reached` }
        }
        // The evening plan heats only while hot water is missing: a stopped
        // element starts when startBaths or more are missing, a running one
        // runs until nothing is. With no plan (no fresh readings) the window
        // heats to its limit as before.
        if (planOn) {
          const plan = planAt(now)
          const shortfall = plan ? plan.shortfallLitres : Infinity
          if (!(shortfall > 0) || (!heaterOn() && shortfall < startLitres)) {
            return { decision: false, reason: `${heatWindow.reason}_met` }
          }
        }
        if (heaterOn() || windowArmed || temperatureTop < heatWindow.target - hysteresis) {
          return { decision: true, reason: heatWindow.reason }
        }
        return { decision: false, reason: `${heatWindow.reason}_reached` }
      }

      // Temperature is sufficient, check hysteresis
      if (temperatureTop !== null && temperatureTop >= (comfortMin + hysteresis)) {
        return { decision: false, reason: 'temperature_sufficient' }
      }

      // Default to maintaining current state (hysteresis zone)
      return {
        decision: heaterOn(),
        reason: `hysteresis_zone_maintain_${heaterOn()}`
      }
    }

    // Baths ready and minutes to one more (#1984). Old or missing top or
    // bottom readings give no number at all, never an old one.
    const bathStatus = () => {
      const top = currentState.temperatureTop
      const bottom = currentState.temperatureBottom
      const fresh = !temperatures.isStale() && Number.isFinite(top) && Number.isFinite(bottom)
      const cold = boilerTank.coldWaterAt(coldWaterByMonth, Date.now(), timeZone)
      const heating = heaterOn()
      const estimate = fresh
        ? boilerTank.bathEstimate({
          top,
          bottom,
          cold,
          heating,
          boostAllowed: boostLimitReason(top, bottom) === null,
          bathLitres,
          bathTempC,
          elementPowerByTempKw,
          tank: tankModel
        })
        : boilerTank.bathEstimate({})
      return {
        ...estimate,
        bathText: boilerTank.bathSentence(estimate, boostButtonName),
        bathInputs: estimate.bathsReady === null ? null : { top, bottom, cold }
      }
    }

    // The plan for the status (#1985): baths need, margin, target, ready,
    // shortfall, the planned start and the last measured evening. nextStart:
    // the time the plan lets the element heat next (now inside a plan
    // window), or null when nothing is missing or there is no plan.
    const planStatus = () => {
      const now = Date.now()
      const plan = planAt(now)
      const clock = localAt(now)
      const base = {
        date: clock.date,
        override: overrideFor(clock.date),
        lastEvening
      }
      if (!plan) return { ...base, need: null, needSource: null, nextStart: null }
      let nextStart = null
      if (plan.shortfallLitres >= startLitres) {
        const periods = periodsAt(now)
        const window = heatWindowAt(now)
        if (window) nextStart = now
        else if (periods.hold && Number.isFinite(periods.minutesToNightBoost)) nextStart = now + periods.minutesToNightBoost * 60 * 1000
        else if (plan.plannedStartMin !== null) nextStart = now + Math.max(0, plan.plannedStartMin - clock.minutes) * 60 * 1000
      }
      return {
        ...base,
        need: plan.need === null ? null : round1(plan.need),
        needSource: plan.needSource,
        marginBaths,
        targetBaths: round1(plan.targetLitres / bathLitres),
        bathsReady: round1(plan.usable / bathLitres),
        capacityBaths: round1(plan.capacity / bathLitres),
        shortfallBaths: round1(plan.shortfallLitres / bathLitres),
        heatMinutes: plan.heatMinutes,
        nextStart
      }
    }

    // The evening use (#1985): from measureFrom to midnight, an energy
    // balance on the tank model. The element energy is the boiler meter's
    // counter, or the model's element power while the element runs. An
    // evening with a gap (a restart, a stop of over 5 min), no fresh
    // readings at either end, or a result out of range is not stored. Only
    // the result is kept across restarts.
    const MAX_TICK_GAP_MS = 5 * 60 * 1000
    let evening = null // { date, startAt, start, cold, meterStart, estKwh, lastAt, broken }
    let lastEvening = null // { date, baths, elementKwh, energySource } of the last stored evening
    let meter = null // { tot, at }: the last boiler meter reading
    const meterFresh = () => meter !== null && Date.now() - meter.at <= maxLoadInputAgeMs
    const freshTemps = () => !temperatures.isStale() &&
      Number.isFinite(currentState.temperatureTop) && Number.isFinite(currentState.temperatureBottom)
    // The element's mean power now, from the model's water at the element
    const elementKwNow = (cold) => {
      const profile = boilerTank.gradualProfile(currentState.temperatureBottom, currentState.temperatureTop, cold, tankModel)
      return boilerTank.elementPowerKw(elementPowerByTempKw, profile[tankModel.elementLayer])
    }

    const startEvening = (now, clock) => {
      const cold = boilerTank.coldWaterAt(coldWaterByMonth, now, timeZone)
      evening = {
        date: clock.date,
        startAt: now,
        start: { top: currentState.temperatureTop, bottom: currentState.temperatureBottom },
        cold,
        meterStart: meterFresh() ? meter.tot : null,
        estKwh: 0,
        lastAt: now,
        broken: freshTemps() ? null : 'no fresh temperature at the start'
      }
    }

    const finishEvening = (rec, now, clock) => {
      const skip = (why) => { if (verbose) console.log(`[${name}] evening ${rec.date} not stored: ${why}`) }
      if (rec.broken) return skip(rec.broken)
      if (now - rec.lastAt > MAX_TICK_GAP_MS || clock.minutes > 10) return skip('no reading at midnight')
      if (!freshTemps()) return skip('no fresh temperature at the end')
      const metered = Number.isFinite(rec.meterStart) && meterFresh() &&
        meter.tot >= rec.meterStart && meter.tot - rec.meterStart < 24
      const elementKwh = metered ? meter.tot - rec.meterStart : rec.estKwh
      const baths = boilerPlan.eveningBaths({
        start: rec.start,
        end: { top: currentState.temperatureTop, bottom: currentState.temperatureBottom },
        elementKwh,
        hours: (now - rec.startAt) / 3600000,
        standbyW,
        cold: rec.cold,
        bathLitres,
        bathTempC,
        model: tankModel
      })
      // A small negative result is a quiet evening within the model error
      if (!Number.isFinite(baths) || baths < -0.5 || baths > maxBaths) return skip(`result out of range (${baths})`)
      const value = round2(Math.max(0, baths))
      // Keep the evenings the need can still use, and a little more
      const keepFrom = boilerPlan.dayNumber(rec.date) - historyDays - 14
      const kept = Object.fromEntries(Object.entries(history())
        .filter(([date]) => (boilerPlan.dayNumber(date) ?? -Infinity) >= keepFrom))
      persistedCache.eveningBaths = { ...kept, [rec.date]: value }
      lastEvening = { date: rec.date, baths: value, elementKwh: round2(elementKwh), energySource: metered ? 'meter' : 'model' }
      if (verbose) console.log(`[${name}] evening ${rec.date}: ${value} baths (element ${round2(elementKwh)} kWh, ${metered ? 'meter' : 'model'})`)
    }

    // "Бани довечера": the value and its date, retained for Home Assistant
    const publishOverride = () => {
      if (!overrideStatusTopic) return
      const o = persistedCache.eveningOverride
      mqtt.publish(overrideStatusTopic, { value: o ? o.baths : null, date: o ? o.date : null }, { retain: true })
    }
    // The value clears itself when its evening is over (at midnight)
    const clearOldOverride = (clock) => {
      const o = persistedCache.eveningOverride
      if (o && o.date !== clock.date) {
        persistedCache.eveningOverride = null
        if (verbose) console.log(`[${name}] evening baths override for ${o.date} cleared`)
        publishOverride()
      }
    }

    // Once a minute: the evening measurement and the override clearing
    const eveningTick = () => {
      if (!planOn) return
      const now = Date.now()
      const clock = localAt(now)
      if (evening && evening.date !== clock.date) {
        finishEvening(evening, now, clock)
        evening = null
      }
      if (evening) {
        const dt = now - evening.lastAt
        if (dt > MAX_TICK_GAP_MS) evening.broken = evening.broken || 'a gap in the measurement'
        else if (heaterOn() && freshTemps()) evening.estKwh += elementKwNow(evening.cold) * dt / 3600000
        evening.lastAt = now
      } else if (clock.minutes >= measureFromMin && clock.minutes < measureFromMin + 5) {
        // Only at the start of the evening: one started later would miss use
        startEvening(now, clock)
      }
      clearOldOverride(clock)
    }

    // The status for monitoring: heaterState is the real state of the element
    // (see heaterOn), contactorState the last contactor status (null: none
    // yet, or no feedback configured).
    const automationStatus = () => ({
      heaterState: heaterOn(),
      contactorState,
      decision: currentState.decision,
      reason: currentState.lastDecisionReason,
      controlMode: currentState.controlMode,
      manualOverrideExpires: currentState.manualOverrideExpires,
      temperatures: {
        top: currentState.temperatureTop,
        bottom: currentState.temperatureBottom,
        solar: currentState.solarTemperature,
        ambient: currentState.ambientTemperature
      },
      solarCirculation: currentState.solarCirculation,
      load: loadStatus(),
      ...bathStatus(),
      ...(planOn && { plan: planStatus() })
    })

    const updateHeaterState = () => {
      if (waitingForContactor()) return
      const { decision, reason } = makeDecision()

      // A contactor that still differs from the decision after a command had
      // time to come back gets the command again (a lost write).
      const resend = Boolean(contactorStatusTopic) && contactorState !== null &&
        decision !== contactorState && !commandPending(decision)

      if (decision !== currentState.decision || reason !== currentState.lastDecisionReason || resend) {
        if (resend && verbose && decision === currentState.decision && reason === currentState.lastDecisionReason) {
          console.log(`[${name}] contactor is ${contactorState}, sending ${decision} again`)
        }
        currentState.decision = decision
        currentState.lastDecision = Date.now()
        currentState.lastDecisionReason = reason
        // Before the publish: the status of this command may come back at once.
        commanded = { state: decision, at: Date.now() }
        // A command for the state the contactor already has needs no answer,
        // unless an older one is still on its way.
        recentCommands = recentCommands.filter(({ at }) => commanded.at - at < commandConfirmMs)
        if (contactorState === null || decision !== contactorState || recentCommands.length) recentCommands.push(commanded)

        if (verbose) {
          console.log(`[${name}] heater decision: ${decision} (${reason})`)
          console.log(`[${name}] temperatures: top=${currentState.temperatureTop}°C, bottom=${currentState.temperatureBottom}°C, solar=${currentState.solarTemperature}°C`)
        }

        mqtt.publish(boilerRelayTopic, {
          state: decision,
          reason,
          temperatures: {
            top: currentState.temperatureTop,
            bottom: currentState.temperatureBottom,
            solar: currentState.solarTemperature,
            ambient: currentState.ambientTemperature
          }
        })

        // Publish status for monitoring
        mqtt.publish(finalAutomationStatusTopic, automationStatus())

        // Publish control mode status
        publishControlModeStatus()
      }
    }

    const alert = telegramAlert({ url: telegramWebhookUrl, httpPost, isEnabled })
    const minutes = Math.round(maxInputAgeMs / 60000)
    const temperatures = watchInputAge({
      inputs: ['top', 'bottom'],
      maxAgeMs: maxInputAgeMs,
      onChange: (stale) => {
        updateHeaterState()
        alert(name, stale
          ? `⚠️ ${name}: no boiler temperature for ${minutes} min. In automatic mode the element is off until it returns.`
          : `✅ ${name}: boiler temperature is back. Normal control again.`)
      }
    })

    // Initialize from cache
    loadState()

    // Subscribe to temperature sensors
    mqtt.subscribe(temperatureTopTopic, (payload) => {
      try {
        const temp = typeof payload === 'object' ? payload.state : payload
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.temperatureTop = temp
          temperatures.seen('top', payload?._tz)
          updateHeaterState()
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing top temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(temperatureBottomTopic, (payload) => {
      try {
        const temp = typeof payload === 'object' ? payload.state : payload
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.temperatureBottom = temp
          temperatures.seen('bottom', payload?._tz)
          bottomSeen(temp, readingTime(payload))
          updateHeaterState()
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing bottom temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(solarTemperatureTopic, (payload) => {
      try {
        const temp = typeof payload === 'object' ? payload.state : payload
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.solarTemperature = temp
          updateHeaterState()
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing solar temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(ambientTemperatureTopic, (payload) => {
      try {
        const temp = typeof payload === 'object' ? payload.state : payload
        if (typeof temp === 'number' && !isNaN(temp)) {
          currentState.ambientTemperature = temp
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing ambient temperature:`, err.message)
        }
      }
    })

    mqtt.subscribe(solarCirculationTopic, (payload) => {
      try {
        const state = typeof payload === 'object' ? payload.state : payload
        currentState.solarCirculation = state === 'on' || state === true
        updateHeaterState()
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing solar circulation:`, err.message)
        }
      }
    })

    if (mainPowerTopic) {
      mqtt.subscribe(mainPowerTopic, (payload) => {
        const watts = payload?.total_p
        if (typeof watts !== 'number' || isNaN(watts)) return
        const at = readingTime(payload)
        mainReadings.push({ at, watts })
        newestMainAt = Math.max(newestMainAt ?? at, at)
        loadChanged()
      })
    }

    if (dishwasherTopic) {
      mqtt.subscribe(dishwasherTopic, (payload) => {
        const watts = payload?.p
        if (typeof watts !== 'number' || isNaN(watts)) return
        const at = readingTime(payload)
        newestDishwasherAt = Math.max(newestDishwasherAt ?? at, at)
        if (watts > dishwasherOnW) lastDishwasherLoadAt = Math.max(lastDishwasherLoadAt ?? at, at)
        loadChanged()
      })
    }

    // A hold or a window that runs out needs no new reading; look every 30 s.
    if (mainPowerTopic || dishwasherTopic) setInterval(loadChanged, 30 * 1000).unref?.()

    if (contactorStatusTopic) {
      mqtt.subscribe(contactorStatusTopic, (payload) => {
        const state = payload !== null && typeof payload === 'object' ? payload.state : payload
        if (typeof state !== 'boolean') return
        const before = contactorState
        contactorState = state
        if (before === state) {
          // A quick ON then OFF can both run between two polls, so no reading
          // answers the first. A reading of the newest command's state well
          // after it was sent answers them all.
          const newest = recentCommands.at(-1)
          if (newest && newest.state === state && Date.now() - newest.at >= COMMAND_SETTLE_MS) recentCommands = []
          return
        }
        const now = Date.now()

        if (before === null) {
          // The first status after a start: the state the element is in. An
          // outside ON from before the restart is kept with its first time;
          // any other running element counts as the controller's own.
          const since = persistedCache.externalOnSince
          externalOn = state && Number.isFinite(since) && now - since < externalOnMaxMs ? { since } : null
          saveState()
          if (verbose) console.log(`[${name}] contactor is ${state ? 'ON' : 'OFF'}${externalOn ? ' (outside ON kept over the restart)' : ''}`)
          updateHeaterState()
          return
        }

        // The controller's own command coming back
        if (answersCommand(state)) {
          // The newest command still differs: decide again, so the rules see
          // the real state and a resend follows when it stays different.
          if (!commandPending(state)) updateHeaterState()
          return
        }

        if (state) {
          externalOn = { since: now }
          externalOff = null
        } else {
          externalOn = null
          externalOff = { since: now }
        }
        saveState()
        if (verbose) console.log(`[${name}] contactor turned ${state ? 'ON' : 'OFF'} by someone else`)
        updateHeaterState()
      })
      // Decide without the contactor state if it does not come.
      setTimeout(updateHeaterState, commandConfirmMs).unref?.()
    }

    if (planOn && boilerMeterTopic) {
      mqtt.subscribe(boilerMeterTopic, (payload) => {
        const tot = payload?.tot
        if (typeof tot !== 'number' || !Number.isFinite(tot)) return
        meter = { tot, at: readingTime(payload) }
      })
    }

    // "Бани довечера" (#1985): a number of baths for this evening, from 0 to
    // overrideMaxBaths, as a number, a text or { value }. An empty value
    // clears it. It only changes the need, never the limits.
    if (planOn && overrideSetTopic) {
      mqtt.subscribe(overrideSetTopic, (payload) => {
        const raw = payload !== null && typeof payload === 'object' ? payload.value : payload
        const now = Date.now()
        if (raw === null || raw === undefined || raw === '' || raw === 'None') {
          persistedCache.eveningOverride = null
        } else {
          const baths = typeof raw === 'string' ? Number(raw) : raw
          if (!boilerPlan.validBaths(baths, overrideMaxBaths)) {
            console.log(`[${name}] evening baths refused: a number from 0 to ${overrideMaxBaths} (got ${JSON.stringify(raw)?.slice(0, 64)})`)
            publishOverride()
            return
          }
          persistedCache.eveningOverride = { date: localAt(now).date, baths: round1(baths) }
        }
        if (verbose) console.log(`[${name}] evening baths override: ${JSON.stringify(persistedCache.eveningOverride)}`)
        publishOverride()
        updateHeaterState()
        mqtt.publish(finalAutomationStatusTopic, automationStatus())
      })
    }

    // Control mode topic
    mqtt.subscribe(controlModeTopic, (payload) => {
      try {
        let newMode = null
        let duration = manualOverrideExpiry

        // Handle different payload formats
        if (typeof payload === 'string') {
          // Direct mode string from HA select
          newMode = payload
        } else if (payload && typeof payload === 'object' && payload.mode) {
          // Object with mode and optional duration
          newMode = payload.mode
          duration = payload.duration || manualOverrideExpiry
        }

        // Calculate vacation duration with smart timing
        // Logic: Vacation typically starts in the morning (8-10am) and people return in the evening (6-8pm)
        // We subtract 6 hours from the nominal vacation days to ensure hot water is ready for evening return
        // Example: 3-day vacation starting Monday 9am -> ends Wednesday 3pm (heater resumes for evening shower)
        const calculateVacationDuration = (mode) => {
          const vacationHours = {
            vacation_3d: 3 * 24 - 6,   // 2.25 days (66 hours) - weekend getaway
            vacation_5d: 5 * 24 - 6,   // 4.75 days (114 hours) - extended weekend
            vacation_7d: 7 * 24 - 6,   // 6.75 days (162 hours) - week vacation
            vacation_10d: 10 * 24 - 6, // 9.75 days (234 hours) - extended vacation
            vacation_14d: 14 * 24 - 6  // 13.75 days (330 hours) - two week vacation
          }
          return vacationHours[mode] ? vacationHours[mode] * 60 * 60 * 1000 : duration
        }

        // vacation_until ends at the time in the payload (#1756), at most
        // 60 days ahead. Without a valid time the command is refused and the
        // mode stays as it was.
        let until = null
        if (newMode === 'vacation_until') {
          until = typeof payload === 'object' ? payload.until : undefined
          const now = Date.now()
          if (!Number.isFinite(until) || until <= now || until > now + MAX_VACATION_UNTIL_MS) {
            console.log(`[${name}] vacation_until refused: "until" must be a time in ms, in the future and at most 60 days ahead (got ${JSON.stringify(until)})`)
            refuseCommand(newMode, 'invalid_until')
            return
          }
        }

        // Validate and set new mode
        const validModes = ['automatic', 'boost', 'manual_on', 'manual_off', 'vacation_3d', 'vacation_5d', 'vacation_7d', 'vacation_10d', 'vacation_14d', 'vacation_until']

        if (validModes.includes(newMode)) {
          const top = currentState.temperatureTop
          const bottom = currentState.temperatureBottom
          const limitReason = boostLimitReason(top, bottom)
          // A boost ends when the bottom reaches boostBottomTarget or the top
          // boostTopLimit. Already there, it would end at once, so it is
          // refused and the mode and its end time stay as they were (#1975,
          // #1976).
          if (newMode === 'boost' && limitReason) {
            console.log(`[${name}] boost refused (${limitReason}): top ${top}°C (limit ${boostTopLimit}°C), bottom ${bottom}°C (target ${boostBottomTarget}°C)`)
            refuseCommand(newMode, limitReason)
            return
          }
          // manual_on at a limit is applied: it heats once the readings fall
          // under the limits. The result says why it does not heat now.
          commandResult(newMode, 'applied', newMode === 'manual_on' && limitReason ? limitReason : 'ok')
          currentState.controlMode = newMode
          // A mode command is the newest order: it ends an outside ON or OFF.
          externalOn = null
          externalOff = null

          if (newMode === 'automatic') {
            // Clear manual override expiry for automatic mode
            currentState.manualOverrideExpires = null
          } else if (newMode === 'boost') {
            // A second press starts the time again.
            currentState.manualOverrideExpires = Date.now() + boostDurationMs
          } else if (newMode === 'vacation_until') {
            currentState.manualOverrideExpires = until
          } else if (newMode.startsWith('vacation_')) {
            // Calculate smart vacation timing (6 hours before evening return)
            const vacationDuration = calculateVacationDuration(newMode)
            currentState.manualOverrideExpires = Date.now() + vacationDuration
          } else {
            // Set expiry for manual modes
            currentState.manualOverrideExpires = Date.now() + duration
          }

          saveState()
          publishControlModeStatus()

          if (verbose) {
            const durationMinutes = currentState.manualOverrideExpires ?
              (currentState.manualOverrideExpires - Date.now()) / 60000 : 0
            console.log(`[${name}] control mode set to: ${newMode}${newMode !== 'automatic' ? ` for ${(durationMinutes/60).toFixed(1)} hours` : ''}`)
          }

          updateHeaterState()
        } else {
          if (verbose) {
            console.log(`[${name}] invalid control mode: ${newMode}`)
          }
          refuseCommand(newMode, 'unknown_mode')
        }
      } catch (err) {
        if (verbose) {
          console.log(`[${name}] error parsing control mode:`, err.message)
        }
      }
    })

    // Initial decision and status
    lastGateKey = gateKey()
    if (planOn) {
      clearOldOverride(localAt(Date.now()))
      publishOverride()
      // A plan window opens on time without a new reading
      setInterval(() => {
        eveningTick()
        updateHeaterState()
      }, 60 * 1000).unref?.()
    }
    updateHeaterState()
    publishControlModeStatus()

    // Periodic heartbeat to ensure service health monitoring
    // A full status even when nothing changed. Monitoring needs a point now
    // and then, and the events processor drops a status without a reason.
    const publishStatus = (fallbackReason, extra) => mqtt.publish(finalAutomationStatusTopic, {
      ...automationStatus(),
      reason: currentState.lastDecisionReason || fallbackReason,
      lastDecision: currentState.lastDecision,
      ...extra,
      timestamp: Date.now()
    })

    // One status soon after start (#1696): the heartbeat comes only after 15
    // minutes, so a restart left a hole in automation_status. The short wait
    // lets the retained inputs arrive first.
    setTimeout(() => {
      updateHeaterState()
      publishStatus('startup', { startup: true })
    }, startupStatusDelayMs).unref?.()

    const heartbeatInterval = setInterval(() => {
      // No input arrives during an outage, so decide here too: a manual mode
      // must still expire on time.
      updateHeaterState()
      publishStatus('heartbeat', { heartbeat: true })

      if (verbose) {
        console.log(`[${name}] heartbeat: ${currentState.controlMode}, heater=${heaterOn()}, temps: top=${currentState.temperatureTop}°C`)
      }
    }, 15 * 60 * 1000) // 15 minutes

    if (verbose) {
      console.log(`[${name}] boiler controller started with config:`, {
        comfortMin,
        emergencyMin,
        maxSafe,
        solarAdvantageMin,
        solarDisadvantageMax,
        hysteresis,
        nightTariff,
        hotWaterLimit,
        boostBottomTarget,
        boostTopLimit,
        nightBoostTarget: boostTarget,
        eveningPlan: planOn ? eveningPlan : null,
        dayTopUp: topUpTarget === null ? null : { minutesBeforeHold: dayTopUp.minutesBeforeHold, target: topUpTarget },
        drawDropK,
        drawWindowMinutes,
        drawLatchMinutes,
        dishwasherTopic,
        mainPowerTopic,
        contactorStatusTopic,
        externalOnMaxMs: externalOnMaxMs / 60000 + ' minutes',
        externalOffHoldMs: externalOffHoldMs / 60000 + ' minutes',
        boostDurationMs: boostDurationMs / 60000 + ' minutes',
        manualOverrideExpiry: manualOverrideExpiry / 60000 + ' minutes',
        heartbeatInterval: '15 minutes'
      })
    }
  }
})