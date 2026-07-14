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

const stringify = require('fast-json-stable-stringify')

const WHEELS = ['fl', 'fr', 'rl', 'rr']
const TEMP_COEFF = 0.18 // psi per °C
const REF_TEMP_C = 15 // cold reference temperature

const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x)
const round2 = (x) => Math.round(x * 100) / 100

module.exports = function createIoniqTpms (name, config = {}) {
  const tpmsTopic = config.tpmsTopic || 'ioniq/parsed/tpms'
  const ambientTopic = config.ambientTopic || 'ioniq/parsed/ambient'
  const prefix = config.outputTopicPrefix || 'ioniq/parsed/derived/'
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  return {
    persistedCache: {
      version: 1,
      // `lastRaw` holds the last processed raw wheel tuple so a frozen (repeated)
      // reading is skipped. Non-critical: a reset at worst re-emits the current
      // reading once, which is harmless.
      default: { lastRaw: null }
    },

    start: async ({ mqtt, persistedCache }) => {
      // Latest ambient temperature, used as a per-wheel fallback when a wheel's
      // own temperature is missing. Not persisted — it refills on the next sample.
      let ambientC = null

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
        const raw = {}
        for (const w of WHEELS) {
          raw[`${w}.psi`] = payload[`${w}.psi`]
          raw[`${w}.c`] = payload[`${w}.c`]
        }
        const rawKey = stringify(raw)
        if (persistedCache.lastRaw && stringify(persistedCache.lastRaw) === rawKey) {
          return // frozen/duplicate reading — nothing changed
        }
        persistedCache.lastRaw = raw

        // Per wheel resolve two temperatures:
        //  - ownTemp: the wheel's actual measured temperature (no fallback). Used
        //    for the wheel-vs-wheel temp_excess comparison — substituting ambient
        //    here would make a dead-sensor wheel report a meaningless excess.
        //  - compTemp: ownTemp, else the cached ambient temp. Used only to
        //    temperature-compensate pressure (psi_cold), where any reasonable
        //    reference temperature is better than none.
        const ownTemp = {}
        const compTemp = {}
        const cold = {}
        for (const w of WHEELS) {
          const wt = payload[`${w}.c`]
          if (isFiniteNum(wt)) ownTemp[w] = wt
          const t = isFiniteNum(wt) ? wt : (isFiniteNum(ambientC) ? ambientC : null)
          if (t !== null) compTemp[w] = t

          const psi = payload[`${w}.psi`]
          if (isFiniteNum(psi) && t !== null) {
            cold[w] = psi - TEMP_COEFF * (t - REF_TEMP_C)
          }
        }

        // Per-wheel cold pressures.
        for (const w of WHEELS) {
          if (cold[w] === undefined) continue
          publish(`tire_${w}_psi_cold`, payload, cold[w], {
            psi: payload[`${w}.psi`], temp: compTemp[w]
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
        const tempWheels = WHEELS.filter((w) => ownTemp[w] !== undefined)
        for (const w of tempWheels) {
          const others = tempWheels.filter((o) => o !== w).map((o) => ownTemp[o])
          if (others.length === 0) continue
          const mean = others.reduce((a, b) => a + b, 0) / others.length
          publish(`tire_${w}_temp_excess`, payload, ownTemp[w] - mean)
        }
      }

      await mqtt.subscribe(ambientTopic, (payload) => {
        ambientC = payload && isFiniteNum(payload.c) ? payload.c : ambientC
        log('ambient', ambientC)
      })
      await mqtt.subscribe(tpmsTopic, onTpms)
    }
  }
}
