// ioniq-cell-health: reduces the BMS frames into pack-level derived signals
// (derived/cell_spread_mv, derived/module_temp_spread_c) that Grafana can alert
// on with a plain classic_conditions threshold, instead of expressing 96-cell
// array math and cross-frame merges in InfluxQL.
//
// Cross-frame joins and staleness (issue #1418)
// ---------------------------------------------
// The logger polls each PID separately, so values that look like one reading are
// really several frames arriving milliseconds to hours apart, and the cache that
// holds them survives restarts and vehicle sleeps. Joining them blindly compares
// a fresh frame against segments from a completely different pack state: in
// production that published cell spreads of 260 and 440 mV against a real spread
// of 20 mV, both on early-morning wake-ups where the cache still held the
// previous evening's ~3.64/3.78 V segments. The 50 mV warning / 100 mV critical
// rules would have paged on either had a corrective sample not landed inside the
// alert's `for: 10m` window.
//
// So `cell_spread_mv` is derived from the `cell_max_v`/`cell_min_v` pair that the
// single `bms/2101` frame already carries. Those two are contemporaneous by
// construction — no join, so no staleness to gate. Across 31419 valid production
// frames they never exceeded 40 mV, i.e. two BMS quantisation steps and well
// under the warning threshold.
//
// The 96-cell reassembly is kept only for `outlierIndex` (which cell deviates
// most from the pack mean), which is diagnostic rather than alerting. It is
// attached to the published message only when the three segments and the bms
// frame all fall inside one freshness window, and omitted otherwise — a missing
// index is harmless (Grafana reads it with `last()`), a stale one is misleading.
// `module_temp_spread_c` joins two topics as well (`bms/2101` + `bms/2105`) and
// carries the same gate.
//
// Clocks: every freshness comparison uses `payload.ts`, the vehicle logger's
// clock, and nothing else. A frame without a usable `ts` is treated as
// unstamped, which closes the gate rather than falling back to the host clock —
// comparing the two directly could wedge a gate permanently open or shut.

// Physically possible reading bounds. These are sanity limits on the decoded
// value, not health thresholds: anything outside them is a corrupt frame, not a
// vehicle state. Cell under/over-voltage and module over-temperature are alerted
// on the raw bms/2101 fields by dedicated Grafana rules, so discarding an
// impossible frame here cannot mask a genuine fault.
const CELL_V_MIN = 1.0
const CELL_V_MAX = 5.0
const MODULE_TEMP_MIN_C = -40
const MODULE_TEMP_MAX_C = 100
// How far below the BMS's own reported pack minimum (`temp_min`) the coldest
// per-module reading may sit before the frame is treated as a corrupt decode.
// See isCoherentWithPackMin.
const MODULE_TEMP_PACK_MIN_TOLERANCE_C = 2

// Widest allowed spread between the frame timestamps taking part in a join.
// A full cells poll cycle completes in ~300 ms and repeats every ~30 s while the
// car is awake, so 10 minutes is generous for genuinely contemporaneous frames
// while still rejecting anything carried across a sleep. Matches the equivalent
// window in ioniq-tpms.
const SEGMENT_FRESHNESS_WINDOW_MS = 10 * 60 * 1000

const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x)

// The framework JSON-parses the MQTT envelope; the cells/module_temps fields
// inside are sometimes already arrays and sometimes JSON-string-encoded, so
// tolerate both (defensive, mirrors ioniq-dtc's parseCodes) rather than let a
// delivery quirk silently corrupt a segment.
//
// Rejects any array containing a physically impossible value, and any all-zero
// array. The OBD logger occasionally decodes a "no data" ECU response as literal
// 0s instead of omitting the frame, and such a frame reaching the spread math is
// not theoretical: on 2026-07-20T05:54:43Z an all-zero bms/2101 frame merged with
// the live bms/2105 temperatures and published module_temp_spread_c = 29 °C,
// which paged the critical (>15 °C) rule.
//
// For cell voltages the range check catches that whether the array is wholly or
// partly zero. For module temperatures 0 °C is a legitimate reading, so the
// all-zero shape needs a rule of its own — five or seven module temperatures
// reading exactly 0.0 in unison is a garbage frame, one of them reading 0.0 is a
// cold pack. It has to stay even though isCoherentWithPackMin covers the partly-
// zero case: on an all-zero frame the BMS reports temp_min = 0 as well, so the
// cross-check sees a perfectly coherent freezing pack.
function parseFloatArray (raw, expectedLen, minValue, maxValue) {
  let arr = raw
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr)
    } catch (err) {
      return null
    }
  } else if (!Array.isArray(arr)) {
    return null
  }
  if (!Array.isArray(arr) || arr.length !== expectedLen || !arr.every(Number.isFinite)) {
    return null
  }
  if (!arr.every((n) => n >= minValue && n <= maxValue)) {
    return null
  }
  if (arr.every((n) => n === 0)) {
    return null
  }
  return arr
}

// The "no data" decode is not always all-or-nothing: production has three
// bms/2101 frames whose module_temps came back partly filled — [27,27,26,0,0],
// [31,31,0,0,0] and [32,31,32,31,0] — and the last two published
// module_temp_spread_c of 31 °C and 32 °C, twice the critical threshold. The
// all-zero rule does not see them and neither does a range check, because 0 °C is
// a physically possible module temperature.
//
// The discriminator is the bms/2101 frame's own `temp_min` field: the BMS reports
// the pack minimum independently of the per-module array, and on all three
// corrupt frames it stayed at the real value (26, 30, 31 °C) while zeros were
// injected into the array. Measured over every bms/2101 frame in the database
// (31422 frames, all of which carry temp_min):
//
//   min(module_temps) − temp_min   frames
//     −31 / −30 / −26              1 each   <- the three known corrupt frames
//     −1                             525
//      0                          27942
//     +1                            2952
//
// so a tolerance of 2 °C sits one step outside the widest clean disagreement and
// 24 °C away from the nearest corrupt frame. Pairing each of the 1586 bms/2105
// frames with its nearest bms/2101 frame shows temp_min tracks the minimum of the
// merged 12-module array to within ±1 °C as well, which is what lets the same
// check cover module_temps_6_12 (see the publish-time check in handleModuleTemps).
//
// Unlike the peer-magnitude rule this replaces ("some element is 0 while another
// is above 10 °C"), it is season-independent: a genuinely near-freezing pack
// reports temp_min ≈ 0 too, and a genuine cold outlier module drags temp_min down
// with it, so neither is rejected. The rule it replaces suppressed both, which
// turned a real winter spread into a silently-too-low published value.
//
// Only the low side is checked. The "no data" decode fills the array with zeros,
// which can only pull the minimum down; the upper end is already bounded by
// MODULE_TEMP_MAX_C, and adding a temp_max check would introduce a rejection path
// no observed frame motivates.
//
// A frame without a usable temp_min is accepted: this is a cross-check against a
// second source, not a freshness gate, and temp_min is present on 100% of
// production frames, so its absence signals an unexpected payload shape rather
// than corruption. Failing open there leaves the all-zero and range rules in
// place instead of silently killing the alerting signal; replaying the 12 days
// of production frames with temp_min stripped costs 3 leaked artefacts, whereas
// failing closed would cost all 32942 points.
function isCoherentWithPackMin (temps, packMin, tolerance) {
  if (!isFiniteNum(packMin)) return true
  return Math.min(...temps) >= packMin - tolerance
}

// Round to 0.1 to strip binary floating-point noise (e.g. (3.70-3.64)*1000 =
// 60.00000000000006) from the value written to InfluxDB and rendered in the
// Grafana annotation. 0.1 keeps well below the ~10 mV / ~0.1 °C sensor
// granularity, so no meaningful precision is lost.
function round1 (n) {
  return Math.round(n * 10) / 10
}

module.exports = function createIoniqCellHealth (name, config) {
  const cellTopics = config.cellTopics ?? [
    'ioniq/parsed/cells/1',
    'ioniq/parsed/cells/33',
    'ioniq/parsed/cells/65'
  ]
  // bms/2101 carries module temperatures 1-5 AND the cell_max_v/cell_min_v pair
  // that cell_spread_mv is derived from. `moduleTemp1Topic` is the pre-#1418
  // name for the same topic and is still honoured so an older config keeps working.
  const bmsTopic = config.bmsTopic ?? config.moduleTemp1Topic ?? 'ioniq/parsed/bms/2101'
  const moduleTemp2Topic = config.moduleTemp2Topic ?? 'ioniq/parsed/bms/2105'
  const cellSpreadOutputTopic = config.cellSpreadOutputTopic ?? 'ioniq/parsed/derived/cell_spread_mv'
  const moduleTempSpreadOutputTopic = config.moduleTempSpreadOutputTopic ?? 'ioniq/parsed/derived/module_temp_spread_c'
  const segmentFreshnessWindowMs = config.segmentFreshnessWindowMs ?? SEGMENT_FRESHNESS_WINDOW_MS
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  // The three cells/* topics map 1:1 to persistedCache.seg0/seg1/seg2 in
  // array order (topic index 0 -> cells 1-32, 1 -> 33-64, 2 -> 65-96).
  const segKeys = ['seg0', 'seg1', 'seg2']

  return {
    persistedCache: {
      version: 2,
      // Each cache key holds the last-known-good parsed array for one source;
      // null means "not yet received" (or "never a good value") — a bad frame
      // never overwrites a good one. `stamps` maps the same keys to the frame
      // timestamp the stored value came from, which is what the freshness gates
      // compare. It has to survive a restart, otherwise every restart would
      // re-open the stale-join hole this bot exists to close.
      // `packMin` is the `temp_min` reported by the same bms/2101 frame that
      // supplied `moduleTemps`; the two are always written together so the
      // publish-time coherence check compares an array against its own frame's
      // pack minimum and never against a newer one.
      default: {
        seg0: null,
        seg1: null,
        seg2: null,
        moduleTemps: null,
        moduleTemps6_12: null,
        packMin: null,
        stamps: {}
      },
      migrate: ({ defaultState, state }) => {
        // v1 -> v2: no per-source timestamps existed. Start empty and keep the
        // carried-over arrays. Seeding the stamps from the carried-over values
        // instead would declare a set that may span an entire vehicle sleep
        // "contemporaneous" — the exact hole this version exists to close.
        // Joined signals stay suppressed until each source is seen again, which
        // takes one poll cycle of an awake car.
        if (!state.stamps || typeof state.stamps !== 'object') {
          state.stamps = { ...defaultState.stamps }
        }
        // A cache carried over without `packMin` leaves the coherence check
        // without an input; it fails open until the next bms/2101 frame refills
        // both fields together.
        if (!('packMin' in state)) {
          state.packMin = defaultState.packMin
        }
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      // A cache written by an older build (or hand-seeded) may lack the stamp
      // map entirely; the bot must not crash on it.
      if (!persistedCache.stamps || typeof persistedCache.stamps !== 'object') {
        persistedCache.stamps = {}
      }
      if (!('packMin' in persistedCache)) {
        persistedCache.packMin = null
      }

      // Freshness gate: the given frame timestamps are only comparable when they
      // all fall inside one window. A missing or non-numeric stamp — source never
      // seen, carried over by a cache migration, or a frame without `ts` — blocks
      // the comparison rather than being guessed at.
      const mutuallyFresh = (stamps) => {
        if (stamps.some((t) => !isFiniteNum(t))) return false
        return (Math.max(...stamps) - Math.min(...stamps)) <= segmentFreshnessWindowMs
      }

      // Stores a good frame under `cacheKey` together with the timestamp it came
      // from. A frame without a usable `ts` is stored but left unstamped, so it
      // can still serve as a value while never passing a freshness gate.
      const store = (cacheKey, value, ts) => {
        persistedCache[cacheKey] = value
        persistedCache.stamps[cacheKey] = isFiniteNum(ts) ? ts : null
      }

      const handleCells = (segKey) => (payload) => {
        const parsed = parseFloatArray(payload && payload.cells, 32, CELL_V_MIN, CELL_V_MAX)
        if (parsed === null) {
          log(`rejected malformed cells frame for ${segKey}, keeping prior segment`)
          return
        }
        store(segKey, parsed, payload.ts)
      }

      // 1-based index of the cell furthest from the pack mean across the
      // reassembled 96-cell array; ties resolve to the lowest index. Returns null
      // when the three segments are not mutually fresh with `frameTs`, so the
      // caller can omit the field instead of publishing a stale index.
      const outlierIndexAt = (frameTs) => {
        const { seg0, seg1, seg2, stamps } = persistedCache
        if (seg0 === null || seg1 === null || seg2 === null) return null
        if (!mutuallyFresh([frameTs, stamps.seg0, stamps.seg1, stamps.seg2])) {
          log('outlierIndex omitted: segments not mutually fresh', stamps)
          return null
        }

        const cells = seg0.concat(seg1, seg2)
        const mean = cells.reduce((sum, cell) => sum + cell, 0) / cells.length
        // Defaults to 1 — arbitrary but harmless — when the pack is perfectly
        // balanced and every cell ties at zero deviation.
        let outlierIndex = 1
        let maxDeviation = -Infinity
        cells.forEach((cell, i) => {
          const deviation = Math.abs(cell - mean)
          if (deviation > maxDeviation) {
            maxDeviation = deviation
            outlierIndex = i + 1
          }
        })
        return outlierIndex
      }

      // cell_spread_mv, from the single bms/2101 frame. Rest-only: a moving pack
      // under load skews cell voltages, so only parked/charging samples are
      // meaningful here.
      const handleCellSpread = (payload) => {
        if (payload.state === 'active') return

        const max = payload.cell_max_v
        const min = payload.cell_min_v
        if (!isFiniteNum(max) || !isFiniteNum(min)) return
        if (max < CELL_V_MIN || max > CELL_V_MAX || min < CELL_V_MIN || min > CELL_V_MAX) {
          log('rejected implausible cell_max_v/cell_min_v', max, min)
          return
        }
        if (max < min) {
          log('rejected incoherent cell_max_v/cell_min_v', max, min)
          return
        }

        const outlierIndex = outlierIndexAt(payload.ts)
        mqtt.publish(cellSpreadOutputTopic, {
          _type: 'ioniq',
          group: 'derived/cell_spread_mv',
          state: payload.state,
          ts: payload.ts,
          value: round1((max - min) * 1000),
          ...(outlierIndex === null ? {} : { outlierIndex })
        })
      }

      // `packMinField` names the field carrying the BMS's own pack minimum on this
      // topic, or is null when the topic does not carry one (bms/2105).
      const handleModuleTemps = (cacheKey, expectedLen, field, packMinField) => (payload) => {
        const parsed = parseFloatArray(
          payload && payload[field], expectedLen, MODULE_TEMP_MIN_C, MODULE_TEMP_MAX_C)
        if (parsed === null) {
          log(`rejected malformed ${field} frame, keeping prior segment`)
          return
        }
        const framePackMin = packMinField === null ? null : payload[packMinField]
        if (!isCoherentWithPackMin(parsed, framePackMin, MODULE_TEMP_PACK_MIN_TOLERANCE_C)) {
          log(`rejected incoherent ${field} frame (min below ${packMinField})`, parsed, framePackMin)
          return
        }
        store(cacheKey, parsed, payload.ts)
        // Written in the same step as the array so the pair can never desync: a
        // frame whose array was rejected above must not leave its pack minimum
        // behind to be checked against the retained array.
        if (packMinField !== null) {
          persistedCache.packMin = isFiniteNum(framePackMin) ? framePackMin : null
        }

        const { moduleTemps, moduleTemps6_12, stamps, packMin } = persistedCache
        if (moduleTemps === null || moduleTemps6_12 === null) return
        // The frame just stored is one of the two, so its stamp is this frame's
        // timestamp; the gate therefore also bounds how stale the other one is.
        if (!mutuallyFresh([stamps.moduleTemps, stamps.moduleTemps6_12])) {
          log('module_temp_spread_c suppressed: frames not mutually fresh', stamps)
          return
        }

        const temps = moduleTemps.concat(moduleTemps6_12)
        // bms/2105 carries no pack minimum of its own, so module_temps_6_12 is
        // cross-checked here instead, against the temp_min of the bms/2101 frame
        // it is being merged with. The freshness gate above has already
        // established that the two frames are comparable, and temp_min tracks the
        // merged 12-module minimum to within ±1 °C across every paired frame in
        // production. Suppressing rather than retaining is deliberate: unlike the
        // per-topic checks there is no known-good merged array to fall back on,
        // and the next frame from either topic re-evaluates in ~30 s.
        if (!isCoherentWithPackMin(temps, packMin, MODULE_TEMP_PACK_MIN_TOLERANCE_C)) {
          log('module_temp_spread_c suppressed: merged temps incoherent with pack minimum', temps, packMin)
          return
        }

        mqtt.publish(moduleTempSpreadOutputTopic, {
          _type: 'ioniq',
          group: 'derived/module_temp_spread_c',
          state: payload.state,
          ts: payload.ts,
          value: round1(Math.max(...temps) - Math.min(...temps))
        })
      }

      // bms/2101 feeds both derived signals, so it gets a single subscription.
      const onModuleTemps1 = handleModuleTemps('moduleTemps', 5, 'module_temps', 'temp_min')
      const onBmsFrame = (payload) => {
        if (!payload) return
        handleCellSpread(payload)
        onModuleTemps1(payload)
      }

      await Promise.all([
        ...cellTopics.map((topic, index) => mqtt.subscribe(topic, handleCells(segKeys[index]))),
        mqtt.subscribe(bmsTopic, onBmsFrame),
        mqtt.subscribe(moduleTemp2Topic, handleModuleTemps('moduleTemps6_12', 7, 'module_temps_6_12', null))
      ])
    }
  }
}
