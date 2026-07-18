// ioniq-sessions: segments the Ioniq telemetry stream into discrete sessions
// and emits ONE summary record per closed session for the "Trips & charging"
// dashboard and parasitic-drain analysis.
//
// Three session kinds cover the timeline with no gaps:
//   trip   — a period of real motion (a fine-grained drive segment)
//   charge — a rest during which energy entered the pack
//   park   — a rest during which no charging occurred
//
// Why the obvious design is wrong (see the design spec §0): the logger only
// lives while ignition is on, so real park/charge periods are DATA GAPS (zero
// samples), and the `state` tag never marks them. Segmentation therefore keys
// off: gear (vmcu, primary drive/park signal), ignition (awake delimiter),
// speed_kph (drive vs idle), inter-sample gaps (rest detection) and cumulative
// pack-counter / SoC deltas (charge detection), with the always-on household
// charger energy meter bounding home charges.
//
// Correctness principles that most edge-cases follow from:
//   * A rest boundary requires the car to actually be AT REST on the far side
//     of a gap — you cannot fall asleep and wake up mid-motion.
//   * Never fabricate a metric: null-not-zero for distance, timing null on an
//     unbounded sleep charge, negative counter delta -> null.
//   * All time math uses receipt time (Date.now()); start_ts/end_ts carry the
//     source payload ts so a session is stamped where it actually happened.
//
// State is kept as small snapshots + reducers + meter edges (NOT a raw sample
// window) so the cache stays tiny and a mid-session restart is cheap.

const SCHEMA_VERSION = 1
// Hard cap on the persisted charger-meter edge record so it can never grow
// unbounded (edges are also pruned per rest close / trip start).
const MAX_METER_EDGES = 64

function isFiniteNum (v) {
  return typeof v === 'number' && Number.isFinite(v)
}

// Config defaults (all PROVISIONAL — re-tune after ~2 weeks of history, spec §11).
const DEFAULTS = {
  bmsTopic: 'ioniq/parsed/bms/2101',
  vmcuTopic: 'ioniq/parsed/vmcu',
  gearParkValue: 'P',
  odometerTopic: 'ioniq/parsed/odometer',
  connectorTopic: 'ioniq/parsed/bcm_b00e',
  ambientTopic: 'ioniq/parsed/ambient',
  chargerMeterTopic: '/modbus/monitoring/charger/reading',
  tripTopic: 'ioniq/derived/trip',
  chargeTopic: 'ioniq/derived/charge',
  parkTopic: 'ioniq/derived/park',
  speedMovingKph: 3,
  minRestSplitMs: 180000,
  restGapMs: 300000,
  rebootMaxGapMs: 300000,
  silenceTimeoutMs: 300000,
  minTripDurationMs: 60000,
  minTripSamples: 3,
  chargeMinKwh: 0.3,
  chargeMinAh: 1,
  chargeMinSocPct: 2,
  chargerMeterOnW: 150,
  chargerMeterOnMinMs: 60000,
  chargerMeterOffMinMs: 120000,
  drainMinDurationMs: 3600000,
  maxPlausibleStepKwh: 40,
  maxPlausibleStepKm: 400,
  maxPlausibleStepAh: 150,
  socField: 'soc',
  // How far a meter power-on/off edge may sit outside the rest window and still
  // bound it. The meter and car share the same server clock but the handshake /
  // end-taper misaligns edges by a few minutes (spec §0.1: aligned within ~5-9 min).
  meterMatchToleranceMs: 900000
}

module.exports = function createIoniqSessions (name, userConfig = {}) {
  const config = { ...DEFAULTS, ...userConfig }
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  const emptyMeterState = () => ({ on: false, aboveSince: null, aboveAct: null, belowSince: null, belowAct: null })

  // A monotonic-counter delta that refuses to fabricate. Returns null when a
  // boundary is missing (incomplete), the delta is negative (a counter reset or
  // bad baseline) or the positive jump exceeds the corruption ceiling. `maxStep`
  // is a corruption guard set ABOVE a full-range trip / bulk charge, never used
  // to cap normal use.
  const safeDelta = (start, end, maxStep) => {
    if (!isFiniteNum(start) || !isFiniteNum(end)) return { value: null, incomplete: true }
    const d = end - start
    if (d < 0) return { value: null, incomplete: true } // reset / bad baseline
    if (isFiniteNum(maxStep) && d > maxStep) return { value: null, incomplete: true } // corruption
    return { value: d, incomplete: false }
  }

  return {
    persistedCache: {
      version: 1,
      // Small state: the single open session (trip or rest) with its start
      // snapshot + running reducers, the charger-meter on/off edge record
      // spanning the current rest, the last-sample bookkeeping used for gap and
      // ignition-edge detection, the de-dup ledger and the emit sequence.
      default: {
        open: null,
        meterEdges: [],
        meterState: emptyMeterState(),
        lastSampleRxTs: null,
        lastSampleTs: null,
        lastIgnition: null,
        lastEmitted: null,
        seq: 0
      },
      migrate: ({ state, defaultState }) => {
        for (const k of Object.keys(defaultState)) {
          if (!(k in state)) state[k] = defaultState[k]
        }
        if (!Array.isArray(state.meterEdges)) state.meterEdges = []
        if (!state.meterState) state.meterState = emptyMeterState()
        return state
      }
    },

    start: async ({ mqtt, persistedCache }) => {
      // Merged latest-view across frames: gear+speed come from vmcu; ignition,
      // soc, hv_kw, counters, aux_12v come from bms/2101; odometer/connector/
      // ambient refresh their own fields. Rebuilt from incoming samples after a
      // restart (the open session's snapshots carry what the metrics need).
      const merged = {}
      let silenceTimer = null
      // The session that was already open when the bot resumed. Only the close of
      // THAT specific session counts as a restart lazy-close (spec §5.4). A trip
      // that resumes and keeps driving "goes live" and clears this, so a normal
      // close long after the restart is not mislabelled restart_lazy_close.
      let restartSession = persistedCache.open
      let restarted = !!restartSession
      const closedByFor = (normal, session) => {
        if (restarted && session === restartSession) {
          restarted = false
          restartSession = null
          return 'restart_lazy_close'
        }
        return normal
      }

      const socOf = (p) => (p ? p[config.socField] : undefined)

      // Snapshot of the boundary-relevant fields, as they stand in the merged
      // view, stamped with this evaluation's payload ts / receipt time.
      const snapshot = (ts, rxTs) => ({
        soc: isFiniteNum(merged.soc) ? merged.soc : null,
        cum_out_kwh: isFiniteNum(merged.cum_out_kwh) ? merged.cum_out_kwh : null,
        cum_in_kwh: isFiniteNum(merged.cum_in_kwh) ? merged.cum_in_kwh : null,
        cum_chg_ah: isFiniteNum(merged.cum_chg_ah) ? merged.cum_chg_ah : null,
        odometer: isFiniteNum(merged.odometer) ? merged.odometer : null,
        aux_12v: isFiniteNum(merged.aux_12v) ? merged.aux_12v : null,
        connector: isFiniteNum(merged.connector) ? merged.connector : null,
        ambient: isFiniteNum(merged.ambient) ? merged.ambient : null,
        ts: isFiniteNum(ts) ? ts : null
      })

      // Classify the current merged view. Motion is detected first: gear D/R OR
      // speed above the moving floor. Speed above the floor wins even over a
      // gear=P reading, because you cannot physically move in park — a P with real
      // speed is a stale gear frame (gear is otherwise the authoritative
      // drive/park signal, P=parked, N=ambiguous continuation).
      const motionState = () => {
        const moving = merged.gear === 'D' || merged.gear === 'R' ||
          (isFiniteNum(merged.speed) && merged.speed > config.speedMovingKph)
        if (moving) return 'moving'
        if (merged.gear === config.gearParkValue) return 'park'
        if (merged.gear === 'N') return 'ambiguous'
        return 'stationary'
      }

      const armSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = setTimeout(onSilence, config.silenceTimeoutMs)
      }

      // --- session open helpers ------------------------------------------------

      const newTrip = (ts, rxTs) => {
        const snap = snapshot(ts, rxTs)
        return {
          kind: 'trip',
          start_ts: ts,
          startSnapshot: snap,
          motionSnapshot: snap, // last IN-MOTION snapshot -> distance/energy end
          lastMotionTs: ts,
          lastSnapshot: snap,
          lastRxTs: rxTs,
          sampleCount: 1,
          maxGapMs: 0,
          speedSum: isFiniteNum(merged.speed) ? merged.speed : 0,
          speedCount: isFiniteNum(merged.speed) ? 1 : 0,
          speedMax: isFiniteNum(merged.speed) ? merged.speed : null,
          powerMax: isFiniteNum(merged.hv_kw) ? merged.hv_kw : null,
          odometerReadings: [],
          // regen accounting: cum_in credits both regen and a plugged top-up; we
          // only accumulate cum_in over intervals where the connector is NOT
          // plugged, so a mid-trip charge is never reported as regen.
          regenCumIn: 0,
          prevCumIn: isFiniteNum(merged.cum_in_kwh) ? merged.cum_in_kwh : null,
          prevConnector: isFiniteNum(merged.connector) ? merged.connector : null,
          containedPlugged: merged.connector === 1,
          stationarySince: null,
          emitted: false
        }
      }

      const recordOdometer = (trip) => {
        if (!trip || trip.kind !== 'trip') return
        if (!isFiniteNum(merged.odometer)) return
        const readings = trip.odometerReadings
        const last = readings.length ? readings[readings.length - 1] : null
        if (!last || last.km !== merged.odometer) {
          readings.push({ km: merged.odometer, ts: isFiniteNum(merged.ts) ? merged.ts : null })
        }
      }

      const newRest = (startTs, startSnap, startRxTs) => ({
        kind: 'rest',
        start_ts: startTs,
        startSnapshot: startSnap,
        lastSnapshot: startSnap,
        lastRxTs: startRxTs,
        end_ts: startTs,
        sampleCount: 0, // 0 for a pure sleep rest (all metrics boundary-derived)
        maxGapMs: 0,
        // Genuine intermediate awake coverage: contiguous in-session samples
        // (gap < restGapMs), EXCLUDING the resuming boundary sample. These pin an
        // awake-mode charge's timing; a lone post-sleep wake sample is not coverage.
        coverageSamples: 0,
        coverageFirstTs: null,
        coverageLastTs: null,
        // charge_connector 0->1 / 1->0 edge timestamps captured within the rest;
        // both are needed to bound a charge to the connector.
        connectorEdges: [],
        connectorPrev: isFiniteNum(startSnap.connector) ? startSnap.connector : null,
        connectorSeen1: startSnap.connector === 1,
        connectorSeenAny: isFiniteNum(startSnap.connector),
        aux12vStart: startSnap.aux_12v,
        emitted: false
      })

      // --- reducers ------------------------------------------------------------

      const accumulate = (open, ts, rxTs, isAwakeSample) => {
        const gap = (open.lastRxTs != null && isFiniteNum(rxTs)) ? rxTs - open.lastRxTs : null
        if (gap != null && gap > open.maxGapMs) open.maxGapMs = gap
        open.lastRxTs = rxTs
        open.lastSnapshot = snapshot(ts, rxTs)
        open.end_ts = isFiniteNum(ts) ? ts : open.end_ts
        if (open.kind === 'trip') {
          if (isAwakeSample) open.sampleCount++
          if (isFiniteNum(merged.speed)) {
            open.speedSum += merged.speed
            open.speedCount++
            open.speedMax = open.speedMax == null ? merged.speed : Math.max(open.speedMax, merged.speed)
          }
          if (isFiniteNum(merged.hv_kw)) {
            open.powerMax = open.powerMax == null ? merged.hv_kw : Math.max(open.powerMax, merged.hv_kw)
          }
          // Regen accounting (cum_in only while unplugged).
          if (isFiniteNum(merged.cum_in_kwh)) {
            if (isFiniteNum(open.prevCumIn)) {
              const d = merged.cum_in_kwh - open.prevCumIn
              if (d >= 0 && open.prevConnector !== 1) open.regenCumIn += d
            }
            open.prevCumIn = merged.cum_in_kwh
          }
          if (isFiniteNum(merged.connector)) open.prevConnector = merged.connector
          if (merged.connector === 1) open.containedPlugged = true
          recordOdometer(open)
        } else {
          if (isAwakeSample) open.sampleCount++
          // Count only genuine intermediate awake coverage: an awake sample that
          // arrived CONTIGUOUSLY (gap < restGapMs). A sample after a sleep gap is a
          // post-sleep resume boundary, not coverage of the charge.
          if (isAwakeSample && (gap == null || gap < config.restGapMs)) {
            open.coverageSamples = (open.coverageSamples || 0) + 1
            if (!isFiniteNum(open.coverageFirstTs) && isFiniteNum(ts)) open.coverageFirstTs = ts
            if (isFiniteNum(ts)) open.coverageLastTs = ts
          }
          if (merged.connector === 1) open.connectorSeen1 = true
          if (isFiniteNum(merged.connector)) open.connectorSeenAny = true
        }
      }

      const advanceMotion = (trip, ts, rxTs) => {
        trip.lastMotionTs = isFiniteNum(ts) ? ts : trip.lastMotionTs
        trip.motionSnapshot = snapshot(ts, rxTs)
        trip.stationarySince = null
      }

      // --- emit ----------------------------------------------------------------

      const topicFor = (kind) => (kind === 'trip' ? config.tripTopic : kind === 'charge' ? config.chargeTopic : config.parkTopic)

      const emit = (kind, record) => {
        const prev = persistedCache.lastEmitted
        // De-dup key = (kind, start_ts, end_ts): consecutive sessions can share a
        // boundary timestamp, so start_ts alone is not enough.
        if (prev && prev.kind === kind && prev.start_ts === record.start_ts && prev.end_ts === record.end_ts) {
          log('suppressing duplicate emit', kind, record.start_ts, record.end_ts)
          return
        }
        const seq = persistedCache.seq + 1
        record.seq = seq
        // Set the de-dup marker in the SAME mutation, BEFORE publishing, so a
        // crash between publish and the async cache flush replays as
        // already-emitted (InfluxDB is idempotent on kind+start_ts; Mongo is
        // at-least-once — documented, not solved here).
        persistedCache.seq = seq
        persistedCache.lastEmitted = { kind, start_ts: record.start_ts, end_ts: record.end_ts, seq }
        mqtt.publish(topicFor(kind), { _type: 'ioniq-session', ...record })
      }

      // --- trip finalize -------------------------------------------------------

      const buildTrip = (trip, closedBy, endTs, gearAtClose) => {
        const start = trip.startSnapshot
        const end = trip.motionSnapshot
        let complete = true
        const flagIncomplete = (r) => { if (r.incomplete) complete = false; return r.value }

        const energyOut = flagIncomplete(safeDelta(start.cum_out_kwh, end.cum_out_kwh, config.maxPlausibleStepKwh))
        const cumInDelta = safeDelta(start.cum_in_kwh, end.cum_in_kwh, config.maxPlausibleStepKwh)
        // energy_regen = cum_in delta with any plugged-in interval excluded.
        // regenCumIn accumulates only the unplugged cum_in gains, so for an
        // all-unplugged trip it equals the raw delta, and for a trip with a mid-stop
        // top-up it is strictly less (that charge energy is not reported as regen).
        // Null only when the delta itself is unusable (missing boundary / reset).
        const energyRegen = cumInDelta.incomplete ? null : trip.regenCumIn
        if (cumInDelta.incomplete) complete = false
        const energyNet = (isFiniteNum(energyOut) && isFiniteNum(energyRegen)) ? energyOut - energyRegen : null

        // Distance needs >=2 DISTINCT odometer readings, else null (never last-first=0).
        const distinct = trip.odometerReadings
        let distanceKm = null
        let odometerCoverage = null
        if (distinct.length >= 2) {
          const first = distinct[0]
          const last = distinct[distinct.length - 1]
          const dd = safeDelta(first.km, last.km, config.maxPlausibleStepKm)
          if (dd.incomplete) complete = false
          distanceKm = dd.value
          if (isFiniteNum(first.ts) && isFiniteNum(last.ts) && endTs > trip.start_ts) {
            const span = (last.ts - first.ts) / 1000
            const dur = (endTs - trip.start_ts) / 1000
            odometerCoverage = dur > 0 ? Math.max(0, Math.min(1, span / dur)) : null
          }
        }

        // Efficiency guarded against null / 0 / NaN / Infinity distance.
        let efficiency = null
        if (isFiniteNum(energyNet) && isFiniteNum(distanceKm) && distanceKm > 0) {
          const e = energyNet / distanceKm * 1000
          if (Number.isFinite(e)) efficiency = e
        }

        const socStart = start.soc
        const socEnd = end.soc
        const socDelta = (isFiniteNum(socStart) && isFiniteNum(socEnd)) ? socEnd - socStart : null
        if (!isFiniteNum(socStart) || !isFiniteNum(socEnd)) complete = false

        return {
          kind: 'trip',
          start_ts: trip.start_ts,
          end_ts: endTs,
          duration_sec: (endTs - trip.start_ts) / 1000,
          distance_km: distanceKm,
          odometer_coverage: odometerCoverage,
          energy_out_kwh: energyOut,
          energy_regen_kwh: energyRegen,
          energy_net_kwh: energyNet,
          efficiency_wh_per_km: efficiency,
          soc_start: socStart,
          soc_end: socEnd,
          soc_delta_pct: socDelta,
          speed_avg_kph: trip.speedCount > 0 ? trip.speedSum / trip.speedCount : null,
          speed_max_kph: trip.speedMax,
          power_max_kw: trip.powerMax,
          ambient_c: isFiniteNum(end.ambient) ? end.ambient : (isFiniteNum(start.ambient) ? start.ambient : null),
          contained_plugged: !!trip.containedPlugged,
          start_truncated: true, // logger powers on ~1-2 min after ignition (spec §0.1)
          complete,
          sample_count: trip.sampleCount,
          max_gap_sec: trip.maxGapMs / 1000,
          closed_by: closedBy,
          gear_at_close: gearAtClose == null ? null : gearAtClose,
          schema_version: SCHEMA_VERSION
        }
      }

      const isDegenerateTrip = (trip, endTs) => {
        const duration = endTs - trip.start_ts
        return duration < config.minTripDurationMs && trip.sampleCount < config.minTripSamples
      }

      // Close the open trip and open a fresh rest starting at the trip end. A
      // degenerate single-sample jitter "trip" is discarded (no record), which
      // also removes the shared-timestamp collision with the following rest.
      const closeTripOpenRest = (trip, closedBy, endTs, gearAtClose, rxTs) => {
        if (!isDegenerateTrip(trip, endTs)) {
          emit('trip', buildTrip(trip, closedBy, endTs, gearAtClose))
        } else {
          log('rejecting degenerate trip', trip.start_ts, endTs)
        }
        // The rest's pre-gap snapshot is the trip's LAST-KNOWN sample (which may
        // carry an awake-idle plug-in / drift after motion ended), not the
        // last-motion snapshot used for the trip's own distance/energy.
        const rest = newRest(endTs, trip.lastSnapshot, rxTs)
        persistedCache.open = rest
        return rest
      }

      // --- rest finalize -------------------------------------------------------

      // Find a charger-meter on/off pair that brackets a power-on interval inside
      // (within tolerance of) the rest window.
      const findMeterInterval = (startTs, endTs) => {
        const edges = persistedCache.meterEdges
        const tol = config.meterMatchToleranceMs
        const onEdge = edges.find((e) => e.type === 'on' && e.ts >= startTs - tol && e.ts <= endTs + tol)
        if (!onEdge) return null
        const offEdge = edges.find((e) => e.type === 'off' && e.ts > onEdge.ts && e.ts <= endTs + tol)
        if (!offEdge) return null
        return { onEdge, offEdge }
      }

      const buildCharge = (rest, closedBy) => {
        const start = rest.startSnapshot
        const end = rest.lastSnapshot
        let complete = true
        const flagIncomplete = (r) => { if (r.incomplete) complete = false; return r.value }

        const energyIn = flagIncomplete(safeDelta(start.cum_in_kwh, end.cum_in_kwh, config.maxPlausibleStepKwh))
        const chargeAh = flagIncomplete(safeDelta(start.cum_chg_ah, end.cum_chg_ah, config.maxPlausibleStepAh))
        const socStart = start.soc
        const socEnd = end.soc
        const socDelta = (isFiniteNum(socStart) && isFiniteNum(socEnd)) ? socEnd - socStart : null
        if (!isFiniteNum(socStart) || !isFiniteNum(socEnd)) complete = false

        // Timing bounding, in priority order. Energy/Ah/SoC deltas above stay valid
        // regardless; only *timing* (duration/power) needs a real bound. When none
        // is available the charge is UNBOUNDED (power null) — never a fabricated
        // drive-to-drive rate over the whole multi-hour rest span (spec §3.5/§4.2).
        let bounds = 'unbounded'
        let durationSec = (rest.end_ts - rest.start_ts) / 1000 // whole-rest span; only reported for unbounded
        let powerAvgKw = null
        let acEnergyKwh = null
        let chargeEfficiency = null

        const meter = findMeterInterval(rest.start_ts, rest.end_ts)
        const cEdges = Array.isArray(rest.connectorEdges) ? rest.connectorEdges : []
        const cOn = cEdges.find((e) => e.type === 'on')
        const cOff = cOn ? cEdges.find((e) => e.type === 'off' && e.ts > cOn.ts) : null
        // Awake-mode coverage is only trustworthy when the rest was logged
        // CONTINUOUSLY — no internal sleep gap >= restGapMs (spec BLOCKER fix).
        const continuous = (rest.maxGapMs || 0) < config.restGapMs
        const coverage = (rest.coverageSamples || 0) > 0 && continuous &&
          isFiniteNum(rest.coverageFirstTs) && isFiniteNum(rest.coverageLastTs) &&
          rest.coverageLastTs > rest.coverageFirstTs

        if (meter) {
          bounds = 'meter'
          durationSec = (meter.offEdge.ts - meter.onEdge.ts) / 1000
          const acDelta = safeDelta(meter.onEdge.act, meter.offEdge.act, config.maxPlausibleStepKwh)
          acEnergyKwh = acDelta.value
          if (isFiniteNum(energyIn) && isFiniteNum(acEnergyKwh) && acEnergyKwh > 0) {
            chargeEfficiency = energyIn / acEnergyKwh
          }
        } else if (cOn && cOff) {
          // Both plug and unplug edges captured -> bound to the connector window.
          bounds = 'connector'
          durationSec = (cOff.ts - cOn.ts) / 1000
        } else if (coverage) {
          // Continuous powered-mode coverage -> bound to first/last genuine awake sample.
          bounds = 'awake'
          durationSec = (rest.coverageLastTs - rest.coverageFirstTs) / 1000
        }

        const durationIsCharge = bounds !== 'unbounded'
        if (durationIsCharge && durationSec > 0 && isFiniteNum(energyIn)) {
          powerAvgKw = energyIn / (durationSec / 3600)
        }

        return {
          kind: 'charge',
          start_ts: rest.start_ts,
          end_ts: rest.end_ts,
          energy_in_kwh: energyIn,
          charge_ah: chargeAh,
          soc_start: socStart,
          soc_end: socEnd,
          soc_delta_pct: socDelta,
          bounds,
          duration_is_charge: durationIsCharge,
          duration_sec: durationSec,
          power_avg_kw: powerAvgKw,
          connector_confirmed: !!rest.connectorSeen1,
          ac_energy_kwh: acEnergyKwh,
          charge_efficiency: chargeEfficiency,
          charge_type: 'unknown',
          complete,
          // Genuine in-session coverage samples (0 for a pure sleep charge).
          sample_count: rest.coverageSamples || 0,
          max_gap_sec: rest.maxGapMs / 1000,
          closed_by: closedBy,
          gear_at_close: null,
          schema_version: SCHEMA_VERSION
        }
      }

      const buildPark = (rest, closedBy) => {
        const start = rest.startSnapshot
        const end = rest.lastSnapshot
        let complete = true
        const socStart = start.soc
        const socEnd = end.soc
        const socDelta = (isFiniteNum(socStart) && isFiniteNum(socEnd)) ? socEnd - socStart : null
        if (!isFiniteNum(socStart) || !isFiniteNum(socEnd)) complete = false
        const durationSec = (rest.end_ts - rest.start_ts) / 1000

        // %/day drain only meaningful for a park longer than the floor.
        let drainPerDay = null
        if (isFiniteNum(socDelta) && (rest.end_ts - rest.start_ts) >= config.drainMinDurationMs && durationSec > 0) {
          drainPerDay = -socDelta / (durationSec / 86400)
        }

        return {
          kind: 'park',
          start_ts: rest.start_ts,
          end_ts: rest.end_ts,
          duration_sec: durationSec,
          soc_start: socStart,
          soc_end: socEnd,
          soc_delta_pct: socDelta,
          soc_drain_pct_per_day: drainPerDay,
          aux12v_start: isFiniteNum(rest.aux12vStart) ? rest.aux12vStart : null,
          aux12v_end: isFiniteNum(end.aux_12v) ? end.aux_12v : null,
          // A park should not be plugged: confirmed when the connector never read 1.
          connector_confirmed: !rest.connectorSeen1,
          complete,
          sample_count: rest.coverageSamples || 0,
          max_gap_sec: rest.maxGapMs / 1000,
          closed_by: closedBy,
          gear_at_close: null,
          schema_version: SCHEMA_VERSION
        }
      }

      // Classify a closed rest as charge or park by pack-counter / SoC deltas,
      // then emit. Energy/Ah/SoC deltas are always valid (differences of monotonic
      // readings), robust even across a total sleep gap.
      const finalizeRest = (rest, closedBy) => {
        const start = rest.startSnapshot
        const end = rest.lastSnapshot
        const dIn = safeDelta(start.cum_in_kwh, end.cum_in_kwh, config.maxPlausibleStepKwh)
        const dAh = safeDelta(start.cum_chg_ah, end.cum_chg_ah, config.maxPlausibleStepAh)
        const dSoc = (isFiniteNum(start.soc) && isFiniteNum(end.soc)) ? end.soc - start.soc : null
        const isCharge =
          (isFiniteNum(dIn.value) && dIn.value >= config.chargeMinKwh) ||
          (isFiniteNum(dAh.value) && dAh.value >= config.chargeMinAh) ||
          (isFiniteNum(dSoc) && dSoc >= config.chargeMinSocPct)

        if (isCharge) {
          emit('charge', buildCharge(rest, closedBy))
        } else {
          emit('park', buildPark(rest, closedBy))
        }
        // Consume the meter edges that belong to this closed rest.
        persistedCache.meterEdges = persistedCache.meterEdges.filter((e) => e.ts > rest.end_ts)
      }

      const closeRestOpenTrip = (rest, ts, rxTs, closedBy) => {
        finalizeRest(rest, closedBy || 'motion_resume')
        persistedCache.open = newTrip(ts, rxTs)
        recordOdometer(persistedCache.open)
      }

      // --- silence timer -------------------------------------------------------

      // Fires silenceTimeoutMs after the last sample. Closes a trailing trip at
      // its LAST-MOTION time (never "now") and opens a pending rest; if a rest is
      // already open it is left as-is (idempotent — never a second rest).
      function onSilence () {
        silenceTimer = null
        const open = persistedCache.open
        if (!open) return
        if (open.kind === 'trip') {
          const endTs = open.lastMotionTs
          const gearAtClose = merged.gear === config.gearParkValue ? config.gearParkValue : null
          closeTripOpenRest(open, closedByFor('silence_timeout', open), endTs, gearAtClose, open.lastRxTs)
          log('silence closed trailing trip at', endTs)
        } else {
          log('silence: rest already open, extending (no second rest)')
        }
      }

      // --- core evaluation (per vmcu / bms sample) -----------------------------

      const evaluate = (ts, rxTs) => {
        const prevRxTs = persistedCache.lastSampleRxTs
        const prevIgnition = persistedCache.lastIgnition
        const gap = prevRxTs != null && isFiniteNum(rxTs) ? rxTs - prevRxTs : null
        const st = motionState()
        const gearP = st === 'park'
        const ignitionEdge = prevIgnition === 1 && merged.ignition === 0
        const gearAtClose = merged.gear === config.gearParkValue ? config.gearParkValue : null
        let open = persistedCache.open

        if (!open) {
          // Cold start: open a trip if moving, else a rest (park by default).
          if (st === 'moving') {
            open = newTrip(ts, rxTs)
            recordOdometer(open)
            persistedCache.open = open
          } else {
            // Seed lastRxTs from the previous sample's receipt time (if any) so a
            // gap that opened this rest is measured; on a true cold start there is
            // no prior reference (null -> the first gap is simply not counted).
            const seedRxTs = isFiniteNum(prevRxTs) ? prevRxTs : rxTs
            open = newRest(ts, snapshot(ts, rxTs), seedRxTs)
            persistedCache.open = open
          }
        } else if (open.kind === 'trip') {
          if (st === 'moving') {
            // Cannot sleep mid-motion: continue the trip regardless of gap length
            // (a highway reboot / tunnel is moving on both sides). A trip that
            // resumes moving after a restart is a LIVE trip, not a lazy-close.
            if (open === restartSession) { restarted = false; restartSession = null }
            accumulate(open, ts, rxTs, gap == null || gap < config.rebootMaxGapMs)
            advanceMotion(open, ts, rxTs)
          } else if (gearP) {
            accumulate(open, ts, rxTs, false)
            open = closeTripOpenRest(open, closedByFor('gear_park', open), open.lastMotionTs, gearAtClose, rxTs)
          } else if (ignitionEdge) {
            accumulate(open, ts, rxTs, false)
            open = closeTripOpenRest(open, closedByFor('ignition_edge', open), open.lastMotionTs, gearAtClose, rxTs)
          } else if (gap != null && gap >= config.restGapMs) {
            // Long gap with a stationary far side = a genuine rest boundary. Close
            // the trip at its last-motion sample; this stationary sample opens the
            // rest and refreshes its snapshot. Seed the rest's lastRxTs from the
            // TRIP's pre-gap receipt time (not this far-side sample's rxTs) so the
            // opening sleep gap lands in maxGapMs and `continuous` becomes false —
            // otherwise coverage-bounding would fabricate a whole-span rate.
            const rest = closeTripOpenRest(open, closedByFor('gap_stationary', open), open.lastMotionTs, gearAtClose, open.lastRxTs)
            accumulate(rest, ts, rxTs, true)
            open = rest
          } else if (st === 'ambiguous') {
            // gear=N (neutral at a light / rolling) is never a split on its own.
            accumulate(open, ts, rxTs, true)
          } else {
            // Stationary (gear absent, low speed), short gap: still the same trip
            // until the OBSERVED stationary stretch exceeds minRestSplitMs.
            accumulate(open, ts, rxTs, true)
            if (open.stationarySince == null) open.stationarySince = rxTs
            if (isFiniteNum(rxTs) && rxTs - open.stationarySince > config.minRestSplitMs) {
              // Seed the rest's lastRxTs from the trip's pre-close receipt time so
              // inter-sample gaps are measured continuously across the boundary.
              const rest = closeTripOpenRest(open, closedByFor('idle_split', open), open.lastMotionTs, gearAtClose, open.lastRxTs)
              accumulate(rest, ts, rxTs, true)
              open = rest
            }
          }
        } else { // open.kind === 'rest'
          if (st === 'moving') {
            // Motion resumes -> the rest ends at THIS sample and is classified.
            // The resuming sample is a boundary, NOT an intermediate awake sample,
            // so it does not count toward sample_count / bounds classification.
            accumulate(open, ts, rxTs, false)
            closeRestOpenTrip(open, ts, rxTs, closedByFor('motion_resume', open))
            open = persistedCache.open
          } else {
            // Still at rest (awake-idle or asleep): extend the rest, refresh its
            // snapshot. A stationary resume does NOT split / close an ongoing rest.
            accumulate(open, ts, rxTs, true)
          }
        }

        persistedCache.lastSampleRxTs = rxTs
        persistedCache.lastSampleTs = ts
        if (isFiniteNum(merged.ignition)) persistedCache.lastIgnition = merged.ignition
        armSilenceTimer()
      }

      // --- telemetry ingestion -------------------------------------------------

      const onBms = (payload) => {
        if (!payload || typeof payload !== 'object') return
        const soc = socOf(payload)
        // Require at least one usable numeric field to advance state.
        const hasUsable = isFiniteNum(payload.ignition) || isFiniteNum(payload.speed_kph) ||
          isFiniteNum(soc) || isFiniteNum(payload.cum_in_kwh) || isFiniteNum(payload.cum_out_kwh)
        if (!hasUsable) { log('ignoring malformed bms payload'); return }
        if (isFiniteNum(payload.ignition)) merged.ignition = payload.ignition
        if (isFiniteNum(payload.speed_kph)) merged.speed = payload.speed_kph
        if (isFiniteNum(soc)) merged.soc = soc
        if (isFiniteNum(payload.hv_kw)) merged.hv_kw = payload.hv_kw
        if (isFiniteNum(payload.aux_12v)) merged.aux_12v = payload.aux_12v
        if (isFiniteNum(payload.cum_out_kwh)) merged.cum_out_kwh = payload.cum_out_kwh
        if (isFiniteNum(payload.cum_in_kwh)) merged.cum_in_kwh = payload.cum_in_kwh
        if (isFiniteNum(payload.cum_chg_ah)) merged.cum_chg_ah = payload.cum_chg_ah
        const ts = isFiniteNum(payload.ts) ? payload.ts : Date.now()
        merged.ts = ts
        evaluate(ts, Date.now())
      }

      const onVmcu = (payload) => {
        if (!payload || typeof payload !== 'object') return
        const hasUsable = typeof payload.gear === 'string' || isFiniteNum(payload.speed_kph)
        if (!hasUsable) { log('ignoring malformed vmcu payload'); return }
        if (typeof payload.gear === 'string') merged.gear = payload.gear
        if (isFiniteNum(payload.speed_kph)) merged.speed = payload.speed_kph
        const ts = isFiniteNum(payload.ts) ? payload.ts : Date.now()
        merged.ts = ts
        evaluate(ts, Date.now())
      }

      // odometer / connector / ambient refresh their fields (and the open
      // session's boundary tracking) but do NOT trigger a state evaluation.
      const onOdometer = (payload) => {
        if (!payload || typeof payload !== 'object') return
        const km = isFiniteNum(payload.odometer) ? payload.odometer : payload.km
        if (!isFiniteNum(km)) return
        merged.odometer = km
        if (isFiniteNum(payload.ts)) merged.ts = payload.ts
        recordOdometer(persistedCache.open)
      }

      const onConnector = (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (!isFiniteNum(payload.charge_connector)) return
        merged.connector = payload.charge_connector
        const open = persistedCache.open
        if (open && open.kind === 'rest') {
          if (!Array.isArray(open.connectorEdges)) open.connectorEdges = []
          const ts = isFiniteNum(payload.ts) ? payload.ts : Date.now()
          const prev = isFiniteNum(open.connectorPrev) ? open.connectorPrev : null
          // Capture the plug (0->1) and unplug (1->0) edges so a charge can be
          // bounded to when the connector was actually engaged.
          if (prev !== 1 && payload.charge_connector === 1) open.connectorEdges.push({ type: 'on', ts })
          else if (prev === 1 && payload.charge_connector === 0) open.connectorEdges.push({ type: 'off', ts })
          open.connectorPrev = payload.charge_connector
          open.connectorSeenAny = true
          if (payload.charge_connector === 1) open.connectorSeen1 = true
        } else if (open && open.kind === 'trip') {
          if (payload.charge_connector === 1) open.containedPlugged = true
          open.prevConnector = payload.charge_connector
        }
      }

      const onAmbient = (payload) => {
        if (!payload || typeof payload !== 'object') return
        const a = isFiniteNum(payload.ambient_c) ? payload.ambient_c : payload.ambient
        if (isFiniteNum(a)) merged.ambient = a
      }

      // Charger meter (a separate always-on Modbus device): debounce its power
      // crossings into on/off EDGES, each storing {ts, act}. Two edges are all a
      // metered charge needs; storing edges (not a raw buffer) lets an on-edge at
      // the START of a 10 h overnight charge survive to rest-close and a restart.
      const onChargerMeter = (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (!isFiniteNum(payload.ap)) return
        const ts = isFiniteNum(payload.ts) ? payload.ts : Date.now()
        const act = isFiniteNum(payload.act) ? payload.act : null
        const ms = persistedCache.meterState
        if (!ms.on) {
          if (payload.ap > config.chargerMeterOnW) {
            if (ms.aboveSince == null) { ms.aboveSince = ts; ms.aboveAct = act } else if (ts - ms.aboveSince >= config.chargerMeterOnMinMs) {
              ms.on = true
              persistedCache.meterEdges.push({ type: 'on', ts: ms.aboveSince, act: ms.aboveAct })
              ms.belowSince = null
            }
          } else {
            ms.aboveSince = null
          }
        } else {
          if (payload.ap < config.chargerMeterOnW) {
            if (ms.belowSince == null) { ms.belowSince = ts; ms.belowAct = act } else if (ts - ms.belowSince >= config.chargerMeterOffMinMs) {
              ms.on = false
              persistedCache.meterEdges.push({ type: 'off', ts: ms.belowSince, act: ms.belowAct })
              ms.aboveSince = null
            }
          } else {
            ms.belowSince = null
          }
        }
        // Persist the mutated meterState (reactivity tracks the assignment).
        persistedCache.meterState = ms

        // Keep the edge record bounded. Edges are consumed on rest close, but while
        // a trip is open any edge older than the trip start belongs to an
        // already-closed rest and is stale; drop those, then hard-cap the length so
        // pathological meter toggling can never grow the cache without limit.
        const open = persistedCache.open
        let edges = persistedCache.meterEdges
        if (open && open.kind === 'trip' && isFiniteNum(open.start_ts)) {
          edges = edges.filter((e) => e.ts >= open.start_ts)
        }
        if (edges.length > MAX_METER_EDGES) edges = edges.slice(edges.length - MAX_METER_EDGES)
        persistedCache.meterEdges = edges
      }

      await Promise.all([
        mqtt.subscribe(config.bmsTopic, onBms),
        mqtt.subscribe(config.vmcuTopic, onVmcu),
        mqtt.subscribe(config.odometerTopic, onOdometer),
        mqtt.subscribe(config.connectorTopic, onConnector),
        mqtt.subscribe(config.ambientTopic, onAmbient),
        mqtt.subscribe(config.chargerMeterTopic, onChargerMeter)
      ])
    }
  }
}
