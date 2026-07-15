// ioniq-12v-ldc: reduces the Ioniq 12 V / LDC (DC-DC converter) telemetry on
// bms/2101 to two numeric derived signals for Grafana:
//   derived/ldc_ok     (0/1) — is the LDC actually charging the 12 V battery?
//   derived/aux12v_drop (0/1) — did the 12 V rail just sag abnormally?
//
// The whole point of ldc_ok is to NOT false-alarm on normal behaviour: under
// heavy traction the LDC de-prioritises 12 V charging (load priority), so
// aux_12v legitimately floats down to ~12.8-13.0 V — that is not a fault. The
// low-voltage judgement is therefore gated on a SUSTAINED low HV load, the only
// regime where a healthy LDC unambiguously holds the rail well above 13.2 V
// (prod: aux_12v mean 13.69 at <0.5 kW vs 13.28 under heavy traction).
//
// All time math uses receipt time (Date.now()), not the payload ts: "sustained
// >=60 s" is a real-elapsed-time judgement and must not depend on the logger's
// clock. The emitted payload passes the source ts/state through per the
// derived-signals convention (phase-3 umbrella §3).

function isFiniteNum (v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// A sample is usable only if the three fields the logic needs are finite
// numbers; a malformed/partial payload must never corrupt the window or emit a
// spurious signal.
function isValidSample (p) {
  return !!p && isFiniteNum(p.aux_12v) && isFiniteNum(p.ignition) && isFiniteNum(p.hv_kw)
}

module.exports = function createIoniq12vLdc (name, config = {}) {
  const inputTopic = config.inputTopic || 'ioniq/parsed/bms/2101'
  const ldcOkTopic = config.ldcOkTopic || 'ioniq/parsed/derived/ldc_ok'
  const auxDropTopic = config.auxDropTopic || 'ioniq/parsed/derived/aux12v_drop'

  const lowVoltThreshold = config.lowVoltThreshold ?? 13.2 // V
  const lowHvKwThreshold = config.lowHvKwThreshold ?? 0.5 // kW
  const lowLoadWindowMs = config.lowLoadWindowMs ?? 15000 // low load must hold this long
  const sustainMs = config.sustainMs ?? 60000 // low-voltage sustain for a fault
  const coverageToleranceMs = config.coverageToleranceMs ?? 5000 // allowed gap at window start
  const fastDropVolts = config.fastDropVolts ?? 0.8 // V
  const fastDropWindowMs = config.fastDropWindowMs ?? 5000
  const slowDropRatePerMin = config.slowDropRatePerMin ?? 0.3 // V/min (parked)
  const slowDropMinSpanMs = config.slowDropMinSpanMs ?? 30000
  const auxDropHoldMs = config.auxDropHoldMs ?? 60000 // latch a sag high this long
  const windowMaxAgeMs = config.windowMaxAgeMs ?? 65000
  const windowMaxSamples = config.windowMaxSamples ?? 300

  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  return {
    persistedCache: {
      version: 1,
      // window: chronological recent samples. auxDropLatchUntil: receipt time
      // until which aux12v_drop is held high after a sag (so a 1 m last() poll
      // reliably catches an otherwise sub-5-s pulse). Persisted so a restart
      // does not blind the detectors for the sustain window.
      default: { window: [], auxDropLatchUntil: 0 },
      migrate: ({ state }) => {
        if (!Array.isArray(state.window)) state.window = []
        if (!isFiniteNum(state.auxDropLatchUntil)) state.auxDropLatchUntil = 0
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      // ldc_ok: 0 (LDC not charging) only when low voltage held continuously for
      // >=60 s while ignition on AND HV load stayed low for the trailing 15 s.
      const evalLdcOk = (window, now) => {
        const recent = window.filter((s) => s.rxTs >= now - sustainMs)
        // Coverage requires BOTH: (a) at least 60 s of history exists (the full
        // window reaches back past the sustain edge — preserves the exact 60 s
        // floor), AND (b) the trailing 60 s is densely populated from near its
        // start (the oldest IN-window sample is within `coverageToleranceMs` of
        // the edge). (b) rejects a lone fresh sample that survived the max-age
        // prune after a telemetry gap (which would otherwise false-fault on one
        // sample); (a) rejects faulting before a genuine 60 s has elapsed.
        const oldest = window[0]
        const covered = !!oldest && oldest.rxTs <= now - sustainMs &&
          recent.length > 0 && recent[0].rxTs <= now - sustainMs + coverageToleranceMs
        if (!covered) return 1

        const ignitionOn = recent.every((s) => s.ignition === 1)
        const lowVolt = recent.every((s) => s.aux_12v < lowVoltThreshold)

        // Sustained low load: the trailing 15 s must be entirely below the
        // threshold. A single coast/regen blip inside heavy traction must not
        // trigger a fault (that low voltage is load-explained).
        const loadTail = window.filter((s) => s.rxTs >= now - lowLoadWindowMs)
        const lowLoad = loadTail.length > 0 && loadTail.every((s) => s.hv_kw < lowHvKwThreshold)

        const fault = ignitionOn && lowVolt && lowLoad
        return fault ? 0 : 1
      }

      // aux12v_drop: instantaneous sag detection (fast edge or slow parked
      // drift), then latched high for the hold window.
      const detectSag = (window, sample, now) => {
        const curr = sample.aux_12v

        // Fast sag: current is >= fastDropVolts below some sample in the last
        // fastDropWindowMs (excluding the current sample at rxTs === now).
        const fastPrev = window.filter((s) => s.rxTs >= now - fastDropWindowMs && s.rxTs < now)
        if (fastPrev.length > 0) {
          const prevMax = Math.max(...fastPrev.map((s) => s.aux_12v))
          if (prevMax - curr >= fastDropVolts) return true
        }

        // Slow parked drift: only while parked, and referenced against the
        // oldest PARKED sample in the sustain window (scoped to parked so an
        // active->parked transition does not mix a driving voltage into the rate).
        if (sample.state === 'parked') {
          const parked = window.filter((s) => s.state === 'parked' && s.rxTs >= now - sustainMs)
          const ref = parked[0]
          if (ref) {
            const spanMs = now - ref.rxTs
            if (spanMs >= slowDropMinSpanMs) {
              const ratePerMin = (ref.aux_12v - curr) / (spanMs / 60000)
              if (ratePerMin >= slowDropRatePerMin) return true
            }
          }
        }
        return false
      }

      await mqtt.subscribe(inputTopic, (payload) => {
        if (!isValidSample(payload)) {
          log('ignoring invalid sample', payload)
          return
        }
        const now = Date.now()

        // Append then prune by age and length (bounded, chronological).
        const window = persistedCache.window
        window.push({
          aux_12v: payload.aux_12v,
          ignition: payload.ignition,
          hv_kw: payload.hv_kw,
          state: payload.state,
          ts: payload.ts,
          rxTs: now
        })
        let pruned = window.filter((s) => s.rxTs >= now - windowMaxAgeMs)
        if (pruned.length > windowMaxSamples) {
          pruned = pruned.slice(pruned.length - windowMaxSamples)
        }
        persistedCache.window = pruned

        const ldcOkValue = evalLdcOk(pruned, now)
        mqtt.publish(ldcOkTopic, {
          _type: 'ioniq',
          group: 'derived/ldc_ok',
          state: payload.state,
          ts: payload.ts,
          value: ldcOkValue
        })

        const sag = detectSag(pruned, payload, now)
        if (sag) persistedCache.auxDropLatchUntil = now + auxDropHoldMs
        const dropValue = (sag || now < persistedCache.auxDropLatchUntil) ? 1 : 0
        mqtt.publish(auxDropTopic, {
          _type: 'ioniq',
          group: 'derived/aux12v_drop',
          state: payload.state,
          ts: payload.ts,
          value: dropValue
        })
      })
    }
  }
}
