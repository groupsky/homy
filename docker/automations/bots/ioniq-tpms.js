// ioniq-tpms: temperature-compensates the Ioniq's per-wheel tire pressures to a
// 15 °C cold reference and derives cross-wheel signals (spread, per-wheel
// temperature excess) onto ioniq/parsed/derived/* so Grafana can alert with a
// trivial threshold. Raw psi is not comparable to the 36 psi cold placard because
// pressure rises ~0.18 psi/°C, so a hot tire reads high; cold-normalization makes
// the number directly comparable.
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

const stringify = require('fast-json-stable-stringify')

const WHEELS = ['fl', 'fr', 'rl', 'rr']
const TEMP_COEFF = 0.18 // psi per °C
const REF_TEMP_C = 15 // cold reference temperature
const AMBIENT_MAX_AGE_MS = 30 * 60 * 1000 // ambient older than this is not a reasonable reference

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
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  return {
    persistedCache: {
      version: 2,
      // `lastRaw` holds the last processed raw wheel tuple so a frozen (repeated)
      // reading is skipped. `wheelChangedAt` maps each wheel to the frame
      // timestamp at which its own values last changed — the freshness gate needs
      // it to survive a restart, otherwise every restart would re-open the
      // wake-up hole this bot exists to close. Non-critical: a reset at worst
      // re-emits the current reading once and treats the next frame as
      // all-fresh, which the motion gate and the alert rule's `for:` still cover.
      default: { lastRaw: null, wheelChangedAt: {} },
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

      const publish = (signal, base, value, extra) => {
        mqtt.publish(prefix + signal, {
          _type: 'ioniq',
          group: 'derived/' + signal,
          state: base.state,
          ts: base.ts,
          value: round2(value),
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
        for (const w of WHEELS) {
          const changed = !prevRaw ||
            prevRaw[`${w}.psi`] !== raw[`${w}.psi`] ||
            prevRaw[`${w}.c`] !== raw[`${w}.c`]
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
            cold[w] = psi - TEMP_COEFF * (t - REF_TEMP_C)
          }
        }

        // Per-wheel cold pressures.
        for (const w of WHEELS) {
          if (cold[w] === undefined) continue
          publish(`tire_${w}_psi_cold`, payload, cold[w], {
            psi: raw[`${w}.psi`], temp: compTemp[w]
          })
        }

        // Spread across all wheels that produced a cold pressure (needs >= 2).
        const coldVals = WHEELS.filter((w) => cold[w] !== undefined).map((w) => cold[w])
        if (coldVals.length >= 2) {
          publish('tire_spread_psi', payload, Math.max(...coldVals) - Math.min(...coldVals))
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
          publish(`tire_${w}_temp_excess`, payload, ownTemp[w] - mean)
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
