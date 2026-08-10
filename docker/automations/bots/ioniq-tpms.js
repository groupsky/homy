// ioniq-tpms: temperature-compensates the Ioniq's per-wheel tire pressures to a
// 15 °C cold reference and derives cross-wheel signals (spread, per-wheel
// temperature excess) onto ioniq/parsed/derived/* so Grafana can alert with a
// trivial threshold. Raw psi is not comparable to the 36 psi / 2.5 bar cold
// placard because pressure rises with temperature, so a hot tire reads high;
// cold-normalization makes the number comparable across a drive.
//
// Each cold pressure is published in both units — `tire_<w>_psi_cold` and
// `tire_<w>_bar_cold`, `tire_spread_psi` and `tire_spread_bar`. The alerts and
// the Tires dashboard both read the bar series, because the owner reads bar
// (issue #1478). Nothing reads the psi series any more: it is kept writing so
// the years of psi points already in InfluxDB stay a continuous series rather
// than a stub that stops on the cutover date. Retire it only together with
// that history.
//
// The under-inflation alerts do NOT read the normalized series — they read
// `tire_<w>_bar_coldstart`, published once per morning from the first fresh
// frame after a long park (issue #1479). A normalized value cannot be compared
// to the placard: the placard is defined at *ambient*, not at this bot's 15 °C
// reference, so the normalized number is off by the gap between the two, which
// changes with the season (~0.12 bar low in August, ~0.19 bar high in January).
// The normalized series stays for the dashboard trend and for the cross-wheel
// spread, where only wheel-to-wheel differences matter and the reference cancels.
//
// TPMS refreshes only on wheel rotation: parked/charging samples are stale and the
// sensor repeats its last reading verbatim. So we evaluate only fresh `active`
// samples and de-duplicate identical consecutive raw readings.
//
// The frame nests per-wheel values (payload.fl.psi); this bot normalizes them to
// an internal flat tuple for dedupe before deriving.
//
// The four values in a frame are NOT contemporaneous: the car latches each
// wheel's last received value independently, so a frame is a mix of "whatever
// each sensor last said", which after a long park can be days old. `psi_cold` and
// `tire_spread_psi` are immune (each wheel is normalized with its own
// temperature, so a stale wheel stays self-consistent), but the cross-wheel
// `temp_excess` comparison is not — during a wake-up the set steps from stale to
// fresh one wheel at a time and the wheel that refreshes last looks 10-15 °C
// hotter than its peers. Two gates protect it (issue #1415):
//   - freshness: all participating wheels must have last changed within a short
//     mutual window, so a mixed stale/fresh set never gets compared;
//   - motion: a dragging brake or failing bearing only heats a wheel while it
//     rolls, so the comparison is meaningless (and misleading) at standstill.
//
// The same staggered wake-up is what makes the coldstart signal work: each
// wheel is judged on its own last-changed timestamp, so FR can publish its
// coldstart at 05:17 while RL and FL are still replaying yesterday's values.

const stringify = require('fast-json-stable-stringify')

const WHEELS = ['fl', 'fr', 'rl', 'rr']
const REF_TEMP_C = 15 // cold reference temperature for the normalized series
const PSI_PER_BAR = 14.5038 // exact value 14.50377; the truncation is 1.8e-6 relative
const AMBIENT_MAX_AGE_MS = 30 * 60 * 1000 // ambient older than this is not a reasonable reference

// Atmospheric pressure, for converting the TPMS's gauge reading to the absolute
// pressure the gas law acts on. The standard atmosphere (101325 Pa) is used
// rather than a measured local value: the car has no barometer, and a 1 kPa
// error here moves a compensated pressure by under 0.001 bar.
const ATM_PSI = 14.6959
const KELVIN_0C = 273.15

// A sealed tyre is a fixed volume of gas, so absolute pressure is proportional
// to absolute temperature (Gay-Lussac). The previous linearisation, a flat
// TEMP_COEFF = 0.18 psi/°C, was ~8 % too steep: measured on FR over a single
// run on 2026-08-09 (33 °C -> 47 °C) the real rate was 0.167 psi/°C, and the
// gas law at these pressures gives 0.155-0.165 psi/°C depending on temperature.
// Over-compensating left `psi_cold` sloping against tyre temperature instead of
// flat, so the "cold" value depended on how long ago the car had been driven.
// Least-squares slope of psi_cold against tyre temperature over all 10 548
// points published across the 27 days to 2026-08-10: -0.0291 psi/°C on the
// linearisation, -0.0099 on the gas law (issue #1479).
//
// Returns null for a temperature at or below absolute zero, which no real
// sensor produces but which would otherwise divide by zero.
const toColdPsi = (psi, tempC) => {
  const tempK = tempC + KELVIN_0C
  if (!(tempK > 0)) return null
  return (psi + ATM_PSI) * (REF_TEMP_C + KELVIN_0C) / tempK - ATM_PSI
}

// Minimum park before a fresh frame counts as a true cold reading. Overnight is
// far longer than this; 6 h is the shortest gap after which the three verified
// mornings showed tyre temperature within a degree or two of the overnight
// ambient minimum (issue #1479).
const COLDSTART_MIN_PARK_MS = 6 * 60 * 60 * 1000

// A cold-start reading goes straight into an alerting series whose query window
// is days wide, and the day gate is consumed the moment one is published — so a
// single implausible frame would both hold the alert for days and block the real
// reading arriving minutes later. Bound it to pressures a road tyre can hold.
// Across the 14 256 raw wheel-readings in the 27 days to 2026-08-10 every value
// fell between 2.14 and 2.61 bar, so this rejects nothing real; it exists for a
// failing sensor reporting 0 (which would page as *critical*) or stuck high.
const COLDSTART_MIN_BAR = 1.0
const COLDSTART_MAX_BAR = 4.5

// Calendar day in the process's local timezone (the automations container runs
// with TZ set from the compose env). "First start of the day" is a statement
// about the owner's morning, so it must not be evaluated in UTC. Europe/Sofia is
// UTC+3 in summer, so local midnight is 21:00 UTC the day before: a 22:00 and an
// 08:00 local start are one local day but two UTC days, and UTC keying would
// publish a cold start for both — the second off a tyre that has sat in the sun.
const localDayKey = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Widest allowed spread between the participating wheels' last-changed times. A
// full set normally refreshes within a couple of minutes of rolling; anything
// wider means at least one value predates the others by an unusable margin.
const WHEEL_FRESHNESS_WINDOW_MS = 10 * 60 * 1000

// Topics that carry `speed_kph`. bms/2101 reports it continuously while the car
// is awake; vmcu carries it alongside the gear.
const SPEED_TOPICS = ['ioniq/parsed/bms/2101', 'ioniq/parsed/vmcu']
const SPEED_MOVING_KPH = 3 // above this = actually rolling (rejects standstill jitter)
const MOTION_MAX_AGE_MS = 30 * 60 * 1000 // motion older than this no longer explains wheel heat
const SPEED_MAX_AGE_MS = 60 * 60 * 1000 // beyond this we no longer know whether the car is moving

const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x)
const round2 = (x) => Math.round(x * 100) / 100
const round3 = (x) => Math.round(x * 1000) / 1000

// Bar is published at 3 decimals, one more than psi. This does NOT make it
// finer than the psi series — 0.001 bar is 0.0145 psi, so it is ~45% coarser —
// but it is fine enough not to add materially to the error that already exists
// in the thresholds, and it stays injective on real data (raw psi arrives in
// 0.2 psi steps and temps in whole °C, so cold pressures land on a 0.02 psi
// lattice = 0.0014 bar apart, which 3 decimals never merges).
//
// The two rules still reading this series carry thresholds that are the old psi
// round numbers converted and rounded to 2 decimals, so their trip points are
// not exact:
//   over >42 -> >2.90 bar   trips at 42.068 psi   (+0.063, fires slightly later)
//   spread >3 -> >0.21 bar  trips at  3.053 psi   (+0.048, fires slightly later)
// Worst case ~0.07 psi, immaterial for tyre pressure. The low/critical rules
// used to be on this list; they now read `tire_<w>_bar_coldstart` with
// thresholds chosen in bar rather than converted (issue #1479).
const toBar = (psi) => round3(psi / PSI_PER_BAR)

// The tpms frame nests each wheel: {"fl":{"psi":37,"c":37}, ...}. (The flat
// "fl.psi" fields visible in InfluxDB are produced by the mqtt-influx converter
// flattening at write time — they are not what this bot receives.) Returns an
// empty object for a missing or non-object wheel so callers can destructure.
const wheelOf = (payload, w) => {
  const v = payload[w]
  return (v && typeof v === 'object') ? v : {}
}

module.exports = function createIoniqTpms (name, config = {}) {
  const tpmsTopic = config.tpmsTopic || 'ioniq/parsed/tpms'
  const ambientTopic = config.ambientTopic || 'ioniq/parsed/ambient'
  const prefix = config.outputTopicPrefix || 'ioniq/parsed/derived/'
  const ambientMaxAgeMs = config.ambientMaxAgeMs || AMBIENT_MAX_AGE_MS
  const wheelFreshnessWindowMs = config.wheelFreshnessWindowMs || WHEEL_FRESHNESS_WINDOW_MS
  // An empty `speedTopics` array disables the motion gate entirely.
  const speedTopics = config.speedTopics === undefined
    ? SPEED_TOPICS
    : [].concat(config.speedTopics)
  const speedMovingKph = config.speedMovingKph || SPEED_MOVING_KPH
  const motionMaxAgeMs = config.motionMaxAgeMs || MOTION_MAX_AGE_MS
  const speedMaxAgeMs = config.speedMaxAgeMs || SPEED_MAX_AGE_MS
  const coldstartMinParkMs = config.coldstartMinParkMs || COLDSTART_MIN_PARK_MS
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  return {
    persistedCache: {
      version: 3,
      // `lastRaw` holds the last processed raw wheel tuple so a frozen (repeated)
      // reading is skipped. `wheelChangedAt` maps each wheel to the frame
      // timestamp at which its own values last changed — the freshness gate needs
      // it to survive a restart, otherwise every restart would re-open the
      // wake-up hole this bot exists to close. Non-critical: a reset at worst
      // re-emits the current reading once and treats the next frame as
      // all-fresh, which the motion gate and the alert rule's `for:` still cover.
      // `coldstartDay` maps each wheel to the local calendar day on which its
      // coldstart reading was last published, so only the first qualifying wake
      // of a day emits one.
      default: { lastRaw: null, wheelChangedAt: {}, coldstartDay: {} },
      migrate: ({ defaultState, state }) => {
        // v1 -> v2: no per-wheel timestamps existed. Start empty and keep the
        // carried-over `lastRaw`, so temp_excess stays suppressed until every
        // wheel has been observed changing at least once — i.e. until the car
        // has actually driven. Seeding the map from the carried-over frame
        // instead would declare a possibly-stale set "all fresh" and re-open the
        // exact hole this migration exists for.
        if (!state.wheelChangedAt || typeof state.wheelChangedAt !== 'object') {
          state.wheelChangedAt = { ...defaultState.wheelChangedAt }
        }
        // v2 -> v3: coldstart bookkeeping did not exist. Starting empty can at
        // worst publish one extra coldstart on the migration day — the long-park
        // gate still applies, so it is a real cold reading either way.
        if (!state.coldstartDay || typeof state.coldstartDay !== 'object') {
          state.coldstartDay = { ...defaultState.coldstartDay }
        }
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      // Latest ambient temperature, used as a per-wheel fallback when a wheel's
      // own temperature is missing. Not persisted — it refills on the next sample.
      // ambientAtMs bounds how long a cached reading stays usable: the car may not
      // report ambient temp again for hours after it sleeps, and compensating a
      // fresh, real psi reading against a stale (e.g. yesterday-afternoon-warm)
      // ambient temp silently skews psi_cold low — any reasonable reference beats
      // none, but a many-hours-old one is not reasonable.
      let ambientC = null
      let ambientAtMs = null

      // Motion state, not persisted: after a restart we simply do not know
      // whether the car is rolling, and the gate fails open in that case.
      let lastSpeedAtMs = null // when we last heard ANY speed reading
      let lastMotionAtMs = null // when we last heard a reading above the moving threshold

      // A cache written by an older build (or a hand-seeded one) may lack the
      // per-wheel timestamp map; the bot must not crash on it.
      if (!persistedCache.wheelChangedAt || typeof persistedCache.wheelChangedAt !== 'object') {
        persistedCache.wheelChangedAt = {}
      }
      if (!persistedCache.coldstartDay || typeof persistedCache.coldstartDay !== 'object') {
        persistedCache.coldstartDay = {}
      }

      // Motion gate. Returns true when the cross-wheel temperature comparison is
      // meaningful — i.e. the car rolled recently enough for a dragging brake or
      // a bad bearing to have deposited heat in one wheel.
      //
      // Fail-safe policy: this suppresses ONLY on positive evidence of
      // standstill (fresh speed telemetry, no motion within motionMaxAgeMs). If
      // speed telemetry is absent or stale we cannot tell, so we allow
      // derivation rather than silently muting a genuine fault forever — the
      // freshness gate and the alert rule's `for:` remain in place either way.
      const movedRecently = () => {
        if (speedTopics.length === 0) return true // gate disabled by configuration
        const now = Date.now()
        const speedKnown = lastSpeedAtMs !== null && (now - lastSpeedAtMs) <= speedMaxAgeMs
        if (!speedKnown) return true
        return lastMotionAtMs !== null && (now - lastMotionAtMs) <= motionMaxAgeMs
      }

      // Freshness gate. `wheels` are the ones that would take part in the
      // comparison; they are only comparable when their last-changed timestamps
      // all fall inside one window. A wheel with no timestamp at all (state was
      // migrated from v1, or it has not moved since) blocks the comparison.
      // On a completely cold cache every wheel is stamped from the first frame,
      // so that frame is compared as-is — the motion gate and the alert rule's
      // `for:` are the backstops for that one case.
      const mutuallyFresh = (wheels) => {
        const stamps = wheels.map((w) => persistedCache.wheelChangedAt[w])
        if (stamps.some((t) => !isFiniteNum(t))) return false
        return (Math.max(...stamps) - Math.min(...stamps)) <= wheelFreshnessWindowMs
      }

      // `roundedValue` must already be rounded by the caller — this helper does
      // not round, because psi and bar round to different precisions. Passing a
      // raw float here ships full double precision to MQTT and InfluxDB.
      const publish = (signal, base, roundedValue, extra) => {
        mqtt.publish(prefix + signal, {
          _type: 'ioniq',
          group: 'derived/' + signal,
          state: base.state,
          ts: base.ts,
          value: roundedValue,
          ...extra
        })
      }

      const onTpms = (payload) => {
        if (!payload || payload.state !== 'active') return

        // Extract the raw wheel tuple in a fixed key order for stable dedupe.
        // Keys stay flat ("fl.psi") purely as an internal fingerprint shape.
        const raw = {}
        for (const w of WHEELS) {
          const { psi, c } = wheelOf(payload, w)
          raw[`${w}.psi`] = psi
          raw[`${w}.c`] = c
        }
        const rawKey = stringify(raw)
        const prevRaw = persistedCache.lastRaw
        if (prevRaw && stringify(prevRaw) === rawKey) {
          return // frozen/duplicate reading — nothing changed
        }

        // Record which wheels actually reported new values in this frame. A TPMS
        // sensor transmits pressure and temperature together, so any change in a
        // wheel's pair means that sensor was heard from at this timestamp; an
        // unchanged pair means the car is still replaying a latched value.
        const frameTs = isFiniteNum(payload.ts) ? payload.ts : Date.now()
        // Snapshot before overwriting: the coldstart gate needs how long each
        // wheel had been silent *before* this frame woke it.
        const prevChangedAt = { ...persistedCache.wheelChangedAt }
        const changedNow = {}
        for (const w of WHEELS) {
          const changed = !prevRaw ||
            prevRaw[`${w}.psi`] !== raw[`${w}.psi`] ||
            prevRaw[`${w}.c`] !== raw[`${w}.c`]
          changedNow[w] = changed
          if (changed) persistedCache.wheelChangedAt[w] = frameTs
        }
        persistedCache.lastRaw = raw

        // Per wheel resolve two temperatures:
        //  - ownTemp: the wheel's actual measured temperature (no fallback). Used
        //    for the wheel-vs-wheel temp_excess comparison — substituting ambient
        //    here would make a dead-sensor wheel report a meaningless excess.
        //  - compTemp: ownTemp, else the cached ambient temp. Used only to
        //    temperature-compensate pressure (psi_cold), where any reasonable
        //    reference temperature is better than none.
        const ambientFresh = isFiniteNum(ambientC) && ambientAtMs !== null &&
          (Date.now() - ambientAtMs) <= ambientMaxAgeMs

        const ownTemp = {}
        const compTemp = {}
        const cold = {}
        for (const w of WHEELS) {
          const wt = raw[`${w}.c`]
          if (isFiniteNum(wt)) ownTemp[w] = wt
          const t = isFiniteNum(wt) ? wt : (ambientFresh ? ambientC : null)
          if (t !== null) compTemp[w] = t

          const psi = raw[`${w}.psi`]
          if (isFiniteNum(psi) && t !== null) {
            const c = toColdPsi(psi, t)
            if (c !== null) cold[w] = c
          }
        }

        // Per-wheel cold pressures, in both units. Everything downstream reads
        // bar (the owner's unit — issue #1478); psi keeps writing only so its
        // existing InfluxDB history stays continuous. Both are derived from the
        // same unrounded `cold[w]` in the same frame, so they cannot drift.
        for (const w of WHEELS) {
          if (cold[w] === undefined) continue
          publish(`tire_${w}_psi_cold`, payload, round2(cold[w]), {
            psi: raw[`${w}.psi`], temp: compTemp[w]
          })
          publish(`tire_${w}_bar_cold`, payload, toBar(cold[w]), {
            bar: toBar(raw[`${w}.psi`]), temp: compTemp[w]
          })
        }

        // Cold-start pressure: the first fresh frame a wheel produces after a
        // long park, published raw. The tyre has equilibrated with ambient
        // overnight, so this reading is directly comparable to the placard with
        // no compensation, no reference temperature and no external sensor —
        // which is exactly what the normalized series cannot offer, because the
        // placard is defined at ambient and the normalized series is not.
        //
        // It is also what stops the low-pressure alert flapping. The normalized
        // series is republished every ~30 s while the car is awake and FR/RL sit
        // within 0.02 bar of the trip point, which is less than one TPMS
        // quantisation step (0.2 psi = 0.014 bar) — so it crosses the line and
        // back several times per drive. One point per morning cannot do that.
        //
        // Three gates, all per wheel (issue #1479):
        //   - long park: the wheel must have been silent for >= 6 h, so the tyre
        //     is at ambient rather than carrying heat from the last drive;
        //   - first start of the day: an afternoon start after the car has sat
        //     in the sun gives a sun-soaked tyre, not a cold one;
        //   - first frame, not an average: the tyre warms ~4 °C in the five
        //     minutes after wake (22 -> 26 °C on 2026-08-10), so averaging the
        //     first few frames biases the reading high.
        // Per wheel and not per frame, because the wheels wake staggered: on
        // 2026-08-04 FR refreshed at 05:17:22Z while FL was still replaying a
        // 40 °C value it had latched the previous evening.
        //
        // Fails closed wherever the evidence is incomplete. Publishing a
        // possibly-warm reading into an alerting series is worse than waiting
        // for tomorrow morning: a missed cold start leaves the alert holding its
        // previous state, a wrong one changes it. Each `continue` below leaves
        // the day UNconsumed, so a later frame the same morning still qualifies.
        const frameDay = localDayKey(frameTs)
        for (const w of WHEELS) {
          if (!prevRaw || !changedNow[w]) continue

          // `changedNow` only says this wheel's (psi, c) pair differs from the
          // previous frame. That is evidence the sensor spoke only if the
          // previous frame carried a pressure for this wheel AND the pressure
          // moved: a wheel that was absent, or that reappears with the value the
          // car latched hours ago, is indistinguishable from a genuine refresh
          // by the pair alone, and would publish an end-of-drive reading as a
          // cold start. A tyre that has cooled over a 6 h park has always moved
          // at least one 0.2 psi step — all 104 cold starts in the 27 days to
          // 2026-08-10 pass both tests, so neither costs a real reading.
          const psi = raw[`${w}.psi`]
          const prevPsi = prevRaw[`${w}.psi`]
          if (!isFiniteNum(psi) || !isFiniteNum(prevPsi) || prevPsi === psi) continue

          const bar = toBar(psi)
          if (bar < COLDSTART_MIN_BAR || bar > COLDSTART_MAX_BAR) {
            log('coldstart rejected: implausible pressure', w, bar)
            continue
          }

          const prevAt = prevChangedAt[w]
          if (!isFiniteNum(prevAt)) continue
          if (frameTs - prevAt < coldstartMinParkMs) continue
          if (persistedCache.coldstartDay[w] === frameDay) continue
          persistedCache.coldstartDay[w] = frameDay
          // Same field shape as tire_<w>_bar_cold so the two are interchangeable
          // in a query. `bar` equals `value` here by construction — that identity
          // *is* the point: a coldstart reading is the raw pressure, untouched.
          const extra = { bar }
          if (ownTemp[w] !== undefined) extra.temp = ownTemp[w]
          publish(`tire_${w}_bar_coldstart`, payload, bar, extra)
          log('coldstart', w, bar, 'after', Math.round((frameTs - prevAt) / 3600000), 'h park')
        }

        // Spread across all wheels that produced a cold pressure (needs >= 2).
        const coldVals = WHEELS.filter((w) => cold[w] !== undefined).map((w) => cold[w])
        if (coldVals.length >= 2) {
          const spread = Math.max(...coldVals) - Math.min(...coldVals)
          publish('tire_spread_psi', payload, round2(spread))
          publish('tire_spread_bar', payload, toBar(spread))
        }

        // Per-wheel temperature excess vs the mean of the OTHER wheels that have a
        // real measured temperature (needs >= 1 other). A hot wheel relative to its
        // peers flags a dragging brake / bearing even if its own pressure cell is
        // dead. Only measured temps participate — no ambient fallback here.
        // Gated on both wheel-set freshness and recent motion — see the file
        // header and the gate helpers for why.
        const tempWheels = WHEELS.filter((w) => ownTemp[w] !== undefined)
        if (!mutuallyFresh(tempWheels)) {
          log('temp_excess suppressed: wheels not mutually fresh', persistedCache.wheelChangedAt)
          return
        }
        if (!movedRecently()) {
          log('temp_excess suppressed: no recent motion')
          return
        }
        for (const w of tempWheels) {
          const others = tempWheels.filter((o) => o !== w).map((o) => ownTemp[o])
          if (others.length === 0) continue
          const mean = others.reduce((a, b) => a + b, 0) / others.length
          publish(`tire_${w}_temp_excess`, payload, round2(ownTemp[w] - mean))
        }
      }

      await mqtt.subscribe(ambientTopic, (payload) => {
        if (payload && isFiniteNum(payload.c)) {
          ambientC = payload.c
          ambientAtMs = Date.now()
        }
        log('ambient', ambientC)
      })
      const onSpeed = (payload) => {
        if (!payload || !isFiniteNum(payload.speed_kph)) return
        lastSpeedAtMs = Date.now()
        if (payload.speed_kph > speedMovingKph) lastMotionAtMs = lastSpeedAtMs
        log('speed', payload.speed_kph)
      }
      for (const topic of speedTopics) {
        await mqtt.subscribe(topic, onSpeed)
      }

      await mqtt.subscribe(tpmsTopic, onTpms)
    }
  }
}
