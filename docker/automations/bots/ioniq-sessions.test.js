const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const createIoniqSessions = require('./ioniq-sessions')

// Real prod topic shapes (spec §7 / §8): gear lives on vmcu, ignition/soc/counters
// on bms/2101, odometer/connector/ambient on their own frames, and the always-on
// household charger meter on the modbus monitoring topic.
const BMS = 'ioniq/parsed/bms/2101'
const VMCU = 'ioniq/parsed/vmcu'
const ODO = 'ioniq/parsed/odometer'
const CONN = 'ioniq/parsed/bcm_b00e'
const AMBIENT = 'ioniq/parsed/ambient'
const GPS = 'ioniq/parsed/gps'
const METER = '/modbus/monitoring/charger/reading'
const TRIP = 'ioniq/derived/trip'
const CHARGE = 'ioniq/derived/charge'
const PARK = 'ioniq/derived/park'
const BASE = 1700000000000

describe('ioniq-sessions bot', () => {
  let mqtt, persistedCache, bot

  function makeMqtt () {
    const cbs = {}
    return {
      _cbs: cbs,
      subscribe: jest.fn().mockImplementation((topic, cb) => { cbs[topic] = cb; return Promise.resolve() }),
      // Capture the de-dup marker AT PUBLISH TIME so tests can assert it was set
      // in the pre-publish mutation (exactly-once mitigation, spec §5.5).
      publish: jest.fn().mockImplementation((topic, payload) => {
        mqtt._published.push({
          topic,
          payload,
          lastEmittedAtPublish: persistedCache.lastEmitted ? { ...persistedCache.lastEmitted } : null
        })
        return Promise.resolve()
      }),
      _published: [],
      _emit: (topic, msg) => (cbs[topic] ? cbs[topic](msg) : undefined)
    }
  }

  function makeCache () {
    return {
      open: null,
      meterEdges: [],
      meterState: { on: false, aboveSince: null, aboveAct: null, belowSince: null, belowAct: null },
      lastSampleRxTs: null,
      lastSampleTs: null,
      lastIgnition: null,
      lastEmitted: null,
      seq: 0
    }
  }

  const start = async (cache) => {
    persistedCache = cache
    bot = createIoniqSessions('ioniq-sessions', {})
    await bot.start({ mqtt, persistedCache })
  }

  // Feed a frame at receipt (fake) time BASE+offset, payload ts = same.
  const at = (offset) => jest.setSystemTime(BASE + offset)
  const bms = (offset, fields) => { at(offset); return mqtt._emit(BMS, { ts: BASE + offset, ...fields }) }
  const vmcu = (offset, fields) => { at(offset); return mqtt._emit(VMCU, { ts: BASE + offset, ...fields }) }
  const odo = (offset, km) => { at(offset); return mqtt._emit(ODO, { ts: BASE + offset, odometer: km }) }
  const conn = (offset, v) => { at(offset); return mqtt._emit(CONN, { ts: BASE + offset, charge_connector: v }) }
  const ambient = (offset, c) => { at(offset); return mqtt._emit(AMBIENT, { ts: BASE + offset, ambient_c: c }) }
  const off = (offset) => bms(offset, { ignition: 0, speed_kph: 0 })
  const gps = (offset, fields) => { at(offset); return mqtt._emit(GPS, { ts: BASE + offset, fix_ts: BASE + offset, provider: 'gps', acc_m: 5, ...fields }) }
  const meter = (offset, ap, act) => { at(offset); return mqtt._emit(METER, { ts: BASE + offset, ap, act }) }

  const published = (topic) => mqtt._published.filter((p) => p.topic === topic).map((p) => p.payload)
  const lastOn = (topic) => { const a = published(topic); return a.length ? a[a.length - 1] : undefined }

  beforeEach(async () => {
    jest.useFakeTimers()
    jest.setSystemTime(BASE)
    mqtt = makeMqtt()
    await start(makeCache())
  })
  afterEach(() => { jest.useRealTimers() })

  it('subscribes to all six input topics', () => {
    expect(mqtt.subscribe).toHaveBeenCalledWith(BMS, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(VMCU, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(ODO, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(CONN, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(AMBIENT, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(METER, expect.any(Function))
  })

  describe('trip segmentation', () => {
    it('emits one clean trip with correct deltas, closed by ignition edge', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 73, hv_kw: 30, cum_out_kwh: 100, cum_in_kwh: 10, cum_chg_ah: 5 })
      odo(0, 1000)
      ambient(0, 21)
      bms(60000, { ignition: 1, speed_kph: 45, soc: 67, hv_kw: 25, cum_out_kwh: 102, cum_in_kwh: 10, cum_chg_ah: 5 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 61, hv_kw: 20, cum_out_kwh: 104.7, cum_in_kwh: 10, cum_chg_ah: 5 })
      odo(120000, 1040)
      // ignition 1->0 with the car stopped closes the awake session at the last motion sample.
      bms(130000, { ignition: 0, speed_kph: 0, soc: 61, hv_kw: 0, cum_out_kwh: 104.7, cum_in_kwh: 10, cum_chg_ah: 5 })

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      const t = trips[0]
      expect(t._type).toBe('ioniq-session')
      expect(t.kind).toBe('trip')
      expect(t.start_ts).toBe(BASE + 0)
      // The trip ends at the power-off sample.
      expect(t.end_ts).toBe(BASE + 130000)
      expect(t.duration_sec).toBe(130)
      expect(t.distance_km).toBeCloseTo(40, 5)
      expect(t.energy_out_kwh).toBeCloseTo(4.7, 5)
      expect(t.soc_start).toBe(73)
      expect(t.soc_end).toBe(61)
      expect(t.soc_delta_pct).toBe(-12)
      expect(t.efficiency_wh_per_km).toBeCloseTo(117.5, 3)
      expect(t.speed_max_kph).toBe(45)
      expect(t.power_max_kw).toBe(30)
      expect(t.ambient_c).toBe(21)
      expect(t.closed_by).toBe('ignition_off')
      expect(t.complete).toBe(true)
      expect(t.start_truncated).toBe(true)
      expect(t.schema_version).toBe(2)
    })

    it('keeps one trip across a P stop with the power on and counts the waiting', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60, cum_out_kwh: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58, cum_out_kwh: 101 })
      vmcu(120000, { gear: 'P', speed_kph: 0 })
      bms(180000, { ignition: 1, speed_kph: 0, soc: 58, cum_out_kwh: 101.1 })
      bms(300000, { ignition: 1, speed_kph: 0, soc: 58, cum_out_kwh: 101.3 }) // 3 min in P, power on
      vmcu(310000, { gear: 'D', speed_kph: 20 })
      bms(400000, { ignition: 1, speed_kph: 40, soc: 56, cum_out_kwh: 102 })
      vmcu(410000, { gear: 'P', speed_kph: 0 })
      bms(420000, { ignition: 0, speed_kph: 0, soc: 56, cum_out_kwh: 102 }) // power off

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(published(PARK)).toHaveLength(0)
      const t = trips[0]
      expect(t.closed_by).toBe('ignition_off')
      expect(t.gear_at_close).toBe('P')
      expect(t.end_ts).toBe(BASE + 420000)
      // 120 s -> 310 s in P, plus 410 s -> 420 s in P before power off.
      expect(t.waiting_sec).toBe(200)
      // cum_out 101 -> 101.3 in the first stop (the second used nothing).
      expect(t.waiting_kwh).toBeCloseTo(0.3, 5)
      expect(t.energy_out_kwh).toBeCloseTo(2, 5)
      // P samples are not driving: they stay out of the speed average.
      expect(t.speed_avg_kph).toBeCloseTo((40 + 40 + 20 + 40) / 4, 5)
    })

    it('ends a trip when the power goes off in P', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58 })
      vmcu(120000, { gear: 'P', speed_kph: 0 })
      bms(135000, { ignition: 0, speed_kph: 0, soc: 58 })

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].closed_by).toBe('ignition_off')
      expect(trips[0].end_ts).toBe(BASE + 135000)
      expect(trips[0].waiting_sec).toBe(15)
      expect(persistedCache.open.kind).toBe('rest')
    })

    it('ends a trip on silence at the last P sample when ignition never reads 0', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58 })
      vmcu(120000, { gear: 'P', speed_kph: 0 })
      vmcu(150000, { gear: 'P', speed_kph: 0 })
      bms(160000, { ignition: 1, speed_kph: 0, soc: 58 }) // no gear in this frame: still P
      expect(published(TRIP)).toHaveLength(0)

      jest.advanceTimersByTime(300000)
      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].closed_by).toBe('silence_timeout')
      expect(trips[0].end_ts).toBe(BASE + 160000)
      expect(trips[0].gear_at_close).toBe('P')
    })

    it('ends a trip when a charge starts', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60, cum_in_kwh: 10 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58, cum_in_kwh: 10 })
      vmcu(120000, { gear: 'P', speed_kph: 0 })
      conn(130000, 1) // plugged in with the power on
      bms(140000, { ignition: 1, speed_kph: 0, soc: 58, cum_in_kwh: 10 })

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].closed_by).toBe('charge_start')
      expect(trips[0].end_ts).toBe(BASE + 120000)
      const rest = persistedCache.open
      expect(rest.kind).toBe('rest')
      expect(rest.connectorEdges).toEqual([{ type: 'on', ts: BASE + 130000 }])
    })

    it('does not split a trip when stopped in gear D past minRestSplit (red light)', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      vmcu(60000, { gear: 'D', speed_kph: 0 })
      vmcu(200000, { gear: 'D', speed_kph: 0 })
      vmcu(400000, { gear: 'D', speed_kph: 0 }) // well past minRestSplit, still in D
      vmcu(410000, { gear: 'P', speed_kph: 0 })
      off(410000) // power off ends the trip

      expect(published(TRIP)).toHaveLength(1)
      expect(published(PARK)).toHaveLength(0)
    })

    it('does not split a trip on gear=N (ambiguous) past minRestSplit', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 59 })
      vmcu(120000, { gear: 'N', speed_kph: 0 })
      vmcu(320000, { gear: 'N', speed_kph: 0 }) // past minRestSplit
      vmcu(330000, { gear: 'P', speed_kph: 0 })
      off(330000) // power off ends the trip

      expect(published(TRIP)).toHaveLength(1)
    })

    it('splits on a stationary stretch beyond minRestSplit when gear is absent', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 59 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 58 })
      // stationary, gear absent
      bms(130000, { ignition: 1, speed_kph: 0, soc: 58 })
      bms(200000, { ignition: 1, speed_kph: 0, soc: 58 })
      bms(320000, { ignition: 1, speed_kph: 0, soc: 58 }) // 190s stationary > minRestSplit

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].closed_by).toBe('idle_split')
      expect(trips[0].end_ts).toBe(BASE + 120000)
    })

    it('does not split a trip across a reboot gap with motion on both sides', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 45, soc: 59 })
      // gap of 400s (>= restGapMs) but the far side is MOVING -> cannot wake mid-motion.
      bms(460000, { ignition: 1, speed_kph: 50, soc: 55 })
      bms(520000, { ignition: 1, speed_kph: 40, soc: 54 })
      vmcu(525000, { gear: 'P', speed_kph: 0 })
      off(525000) // power off ends the trip

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].end_ts).toBe(BASE + 525000)
      expect(published(PARK)).toHaveLength(0)
    })

    it('does not split a trip on a 2-minute reboot gap with a brief stationary reading', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 45, soc: 59 })
      // 2-min reboot gap (< rebootMaxGapMs), momentary 0 speed as the logger comes up.
      bms(180000, { ignition: 1, speed_kph: 0, soc: 58 })
      bms(185000, { ignition: 1, speed_kph: 45, soc: 58 })
      vmcu(200000, { gear: 'P', speed_kph: 0 })
      off(200000) // power off ends the trip

      expect(published(TRIP)).toHaveLength(1)
      expect(published(PARK)).toHaveLength(0)
    })

    it('rejects a degenerate single-sample jitter trip (no record, no timestamp collision)', () => {
      bms(0, { ignition: 1, speed_kph: 0, soc: 60 }) // stationary -> opens a rest (park)
      bms(60000, { ignition: 1, speed_kph: 5, soc: 60 }) // lone jitter above 3 km/h -> opens a trip
      bms(65000, { ignition: 0, speed_kph: 0, soc: 60 }) // ignition edge closes the 1-sample trip

      expect(published(TRIP)).toHaveLength(0)
    })
  })

  describe('start check and trip ends', () => {
    // Made-up coordinates for the tests only.
    const A = { lat: 10, lon: 20 }
    const B = { lat: 10.01, lon: 20 } // about 1.1 km north of A

    // A first trip that ends with power off at A, then the logger sleeps.
    const firstTripEndingAt = (pos) => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60, cum_out_kwh: 100, cum_in_kwh: 10 })
      odo(0, 1000)
      bms(60000, { ignition: 1, speed_kph: 40, soc: 59, cum_out_kwh: 101, cum_in_kwh: 10 })
      odo(60000, 1002)
      gps(110000, pos)
      vmcu(120000, { gear: 'P', speed_kph: 0 })
      bms(130000, { ignition: 0, speed_kph: 0, soc: 59, cum_out_kwh: 101, cum_in_kwh: 10 })
      jest.advanceTimersByTime(300000) // the logger goes quiet
    }

    it('marks a start checked when the first readings match the last ones', () => {
      firstTripEndingAt(A)
      const W = 3600000 // wakes an hour later, already moving
      bms(W, { ignition: 1, speed_kph: 20, soc: 59, cum_out_kwh: 101.05, cum_in_kwh: 10 })
      gps(W + 5000, { lat: A.lat + 0.0002, lon: A.lon }) // about 22 m
      odo(W + 10000, 1002)
      bms(W + 60000, { ignition: 1, speed_kph: 40, soc: 58, cum_out_kwh: 102, cum_in_kwh: 10 })
      off(W + 70000)

      const trips = published(TRIP)
      expect(trips).toHaveLength(2)
      const t = trips[1]
      expect(t.start_check).toBe('checked')
      expect(t.gap_km).toBeNull()
      expect(t.gap_kwh).toBeNull()
      expect(t.gap_m).toBeNull()
      expect(t.start_odometer).toBe(1002)
      expect(t.start_cum_out_kwh).toBe(101.05)
      expect(t.start_cum_in_kwh).toBe(10)
      expect(t.start_lat).toBeCloseTo(A.lat + 0.0002, 6)
      expect(t.end_odometer).toBe(1002)
      expect(t.end_cum_out_kwh).toBe(102)
      // The first trip: its end position is the fix 20 s before the end.
      expect(trips[0].end_lat).toBe(A.lat)
      expect(trips[0].end_lon).toBe(A.lon)
    })

    it('marks a start filled with the gaps when the car moved before the logger woke', () => {
      firstTripEndingAt(A)
      const W = 3600000
      bms(W, { ignition: 1, speed_kph: 50, soc: 57, cum_out_kwh: 102.5, cum_in_kwh: 10.2 })
      gps(W + 5000, B)
      odo(W + 10000, 1009)
      off(W + 70000)

      const t = published(TRIP)[1]
      expect(t.start_check).toBe('filled')
      expect(t.gap_km).toBe(7)
      expect(t.gap_kwh).toBeCloseTo(1.5, 5)
      expect(t.gap_m).toBeGreaterThan(1000)
      expect(t.gap_m).toBeLessThan(1200)
      expect(t.start_truncated).toBe(true)
    })

    it('leaves the start unknown without a reading before the trip', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 59 })
      off(70000)
      const t = published(TRIP)[0]
      expect(t.start_check).toBe('unknown')
      expect(t.start_lat).toBeNull()
      expect(t.end_lat).toBeNull()
    })

    it('ignores GPS fixes that are not real or not accurate', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      gps(1000, { ...A, provider: 'network' })
      gps(2000, { ...A, acc_m: 80 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 59 })
      off(70000)
      const t = published(TRIP)[0]
      expect(t.start_lat).toBeNull()
      expect(t.end_lat).toBeNull()
    })
  })

  describe('rest classification', () => {
    it('emits an UNBOUNDED charge across a sleep gap without fabricating a rate', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 100, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 102, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 104, cum_in_kwh: 20, cum_chg_ah: 100 })
      // silence closes the trailing trip at the last motion sample, opening a pending rest.
      jest.advanceTimersByTime(300000)
      // plug in (captured while the logger briefly lingers), then long sleep.
      conn(430000, 1)
      // resume ~overnight later, moving, with a big SoC / cum_in jump = invisible charge.
      bms(500000, { ignition: 1, speed_kph: 5, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      expect(published(TRIP)).toHaveLength(1)
      expect(published(TRIP)[0].closed_by).toBe('silence_timeout')
      expect(published(TRIP)[0].end_ts).toBe(BASE + 120000)

      const charges = published(CHARGE)
      expect(charges).toHaveLength(1)
      const c = charges[0]
      expect(c.kind).toBe('charge')
      expect(c.energy_in_kwh).toBeCloseTo(10.1, 5)
      expect(c.soc_delta_pct).toBe(32)
      expect(c.bounds).toBe('unbounded')
      expect(c.duration_is_charge).toBe(false)
      expect(c.power_avg_kw).toBeNull() // never a fabricated ~1 kW drive-to-drive rate
      expect(c.connector_confirmed).toBe(true)
      expect(published(PARK)).toHaveLength(0)
    })

    it('emits a METER-BOUNDED home charge with real power, AC energy and efficiency', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 100, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 102, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 104, cum_in_kwh: 20, cum_chg_ah: 100 })
      vmcu(122000, { gear: 'P', speed_kph: 0 }) // park closes trip, opens rest
      off(122000) // power off ends the trip
      conn(123000, 1)
      // charger meter: power on 200s..300s (debounced), then off.
      meter(200000, 1200, 1000)
      meter(260000, 1200, 1000.5) // sustained >60s -> ON edge at 200000
      meter(300000, 0, 1012.46)
      meter(420000, 0, 1012.46) // below >120s -> OFF edge at 300000
      bms(430000, { ignition: 1, speed_kph: 5, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const charges = published(CHARGE)
      expect(charges).toHaveLength(1)
      const c = charges[0]
      expect(c.bounds).toBe('meter')
      expect(c.duration_is_charge).toBe(true)
      expect(c.energy_in_kwh).toBeCloseTo(10.1, 5)
      expect(c.ac_energy_kwh).toBeCloseTo(12.46, 5)
      expect(c.charge_efficiency).toBeCloseTo(10.1 / 12.46, 5)
      expect(c.duration_sec).toBe(100)
      expect(typeof c.power_avg_kw).toBe('number')
      expect(Number.isFinite(c.power_avg_kw)).toBe(true)
      expect(c.connector_confirmed).toBe(true)
    })

    it('does not fabricate a rate on a realistic overnight charge (stationary wake before motion)', () => {
      // The logger boots ~1-2 min AFTER ignition, so the first post-sleep sample
      // is STATIONARY (driver has not pulled away yet). That trailing wake sample
      // must not be mistaken for genuine intermediate charge coverage.
      bms(0, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 100, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 102, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 104, cum_in_kwh: 20, cum_chg_ah: 100 })
      jest.advanceTimersByTime(300000) // silence closes trip, opens pending rest
      conn(430000, 1) // plugged, no OFF edge captured (logger slept through unplug)
      // resume: stationary wake sample first, THEN motion — realistic ordering.
      bms(500000, { ignition: 1, speed_kph: 0, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })
      expect(published(CHARGE)).toHaveLength(0) // stationary resume must not close the rest
      bms(560000, { ignition: 1, speed_kph: 5, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const charges = published(CHARGE)
      expect(charges).toHaveLength(1)
      const c = charges[0]
      expect(c.bounds).toBe('unbounded')
      expect(c.power_avg_kw).toBeNull() // NOT a fabricated ~74 kW rate over the whole rest span
      expect(c.duration_is_charge).toBe(false)
      expect(c.energy_in_kwh).toBeCloseTo(10.1, 5) // energy still valid
    })

    it('bounds a charge to captured connector edges (bounds:connector), not the whole rest', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 52, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 52, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 52, cum_in_kwh: 20, cum_chg_ah: 100 })
      vmcu(122000, { gear: 'P', speed_kph: 0 }) // close trip, open rest
      off(122000) // power off ends the trip
      conn(150000, 0)
      conn(180000, 1) // 0->1 ON edge at 180000
      bms(200000, { ignition: 1, speed_kph: 0, soc: 70, cum_in_kwh: 25, cum_chg_ah: 115 })
      bms(260000, { ignition: 1, speed_kph: 0, soc: 80, cum_in_kwh: 29, cum_chg_ah: 125 })
      conn(300000, 0) // 1->0 OFF edge at 300000
      bms(360000, { ignition: 1, speed_kph: 5, soc: 84, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const c = published(CHARGE)
      expect(c).toHaveLength(1)
      expect(c[0].bounds).toBe('connector')
      expect(c[0].duration_sec).toBe(120) // 180000..300000, NOT the ~238s whole-rest span
      expect(c[0].energy_in_kwh).toBeCloseTo(10.1, 5)
      expect(typeof c[0].power_avg_kw).toBe('number')
    })

    it('bounds a continuous powered-mode charge to intermediate awake samples (bounds:awake)', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 52, cum_in_kwh: 20 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 52, cum_in_kwh: 20 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 52, cum_in_kwh: 20 })
      vmcu(122000, { gear: 'P', speed_kph: 0 })
      off(122000) // power off ends the trip
      // continuous awake coverage (no sleep gap), NO connector edges, NO meter
      bms(180000, { ignition: 1, speed_kph: 0, soc: 60, cum_in_kwh: 22 })
      bms(240000, { ignition: 1, speed_kph: 0, soc: 66, cum_in_kwh: 24 })
      bms(300000, { ignition: 1, speed_kph: 0, soc: 70, cum_in_kwh: 26 })
      bms(360000, { ignition: 1, speed_kph: 5, soc: 70, cum_in_kwh: 26 }) // resume moving

      const c = published(CHARGE)
      expect(c).toHaveLength(1)
      expect(c[0].bounds).toBe('awake')
      expect(c[0].duration_sec).toBe(120) // coverage span 180000..300000, NOT whole-rest span
      expect(typeof c[0].power_avg_kw).toBe('number')
    })

    it('does not fabricate a rate when a charge opens via gap_stationary (opening gap recorded)', () => {
      // Closes via gap_stationary (NOT the silence timer): a single gap >= restGapMs
      // whose far side is stationary and carries the charge energy, then a
      // continuous awake tail, then motion. The opening sleep gap MUST land in
      // maxGapMs so `continuous` is false and the charge degrades to unbounded.
      bms(0, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 100, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 102, cum_in_kwh: 20, cum_chg_ah: 100 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 52, cum_out_kwh: 104, cum_in_kwh: 20, cum_chg_ah: 100 })
      // 340s gap (>= restGapMs) with the charge landing in it; far side stationary.
      bms(460000, { ignition: 1, speed_kph: 0, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })
      // continuous awake tail (contiguous samples)
      bms(520000, { ignition: 1, speed_kph: 0, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })
      bms(580000, { ignition: 1, speed_kph: 0, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })
      bms(640000, { ignition: 1, speed_kph: 5, soc: 84, cum_out_kwh: 104, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const c = published(CHARGE)
      expect(c).toHaveLength(1)
      expect(c[0].bounds).toBe('unbounded')
      expect(c[0].power_avg_kw).toBeNull() // NOT a fabricated ~600 kW rate
      expect(c[0].duration_is_charge).toBe(false)
      expect(c[0].energy_in_kwh).toBeCloseTo(10.1, 5)
      expect(c[0].max_gap_sec).toBe(340) // the real opening gap, not ~0/30
    })

    it('classifies a parasitic-drain park and computes %/day drain', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 60 })
      vmcu(122000, { gear: 'P', speed_kph: 0, aux_12v: 12.8 })
      off(122000) // power off ends the trip
      bms(123000, { ignition: 1, speed_kph: 0, soc: 60, aux_12v: 12.8 })
      // resume 2h later, SoC drained 5% -> park, negative delta.
      bms(120000 + 7200000, { ignition: 1, speed_kph: 5, soc: 55, aux_12v: 12.4 })

      const parks = published(PARK)
      expect(parks).toHaveLength(1)
      const p = parks[0]
      expect(p.kind).toBe('park')
      expect(p.soc_delta_pct).toBe(-5)
      expect(p.soc_drain_pct_per_day).toBeCloseTo(60, 1) // 5% over 2h -> 60%/day
      expect(p.connector_confirmed).toBe(true)
    })

    it('nulls %/day drain for a park shorter than drainMinDurationMs', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 60 })
      vmcu(122000, { gear: 'P', speed_kph: 0 })
      off(122000) // power off ends the trip
      // resume only 30 min later (< 1 h floor).
      bms(120000 + 1800000, { ignition: 1, speed_kph: 5, soc: 59 })

      const parks = published(PARK)
      expect(parks).toHaveLength(1)
      expect(parks[0].soc_drain_pct_per_day).toBeNull()
    })

    it('collapses awake-idle + sleep into exactly one rest', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 60 })
      // awake-idle stationary long enough to split the trip -> opens a rest
      bms(130000, { ignition: 1, speed_kph: 0, soc: 60 })
      bms(200000, { ignition: 1, speed_kph: 0, soc: 60 })
      bms(320000, { ignition: 1, speed_kph: 0, soc: 60 }) // idle_split
      bms(380000, { ignition: 1, speed_kph: 0, soc: 60 }) // still awake-idle, in the rest
      // then the car sleeps: silence timer fires -> must NOT create a second rest
      jest.advanceTimersByTime(300000)
      // resume moving -> exactly one rest is closed
      bms(700000, { ignition: 1, speed_kph: 5, soc: 60 })

      expect(published(TRIP)).toHaveLength(1)
      expect(published(PARK)).toHaveLength(1)
      expect(published(CHARGE)).toHaveLength(0)
    })
  })

  describe('missing-data & counter guards', () => {
    it('nulls distance and efficiency with fewer than 2 distinct odometer readings', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60, cum_out_kwh: 100, cum_in_kwh: 10 })
      odo(0, 1000) // only ONE odometer reading
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58, cum_out_kwh: 102, cum_in_kwh: 10 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 56, cum_out_kwh: 104, cum_in_kwh: 10 })
      vmcu(125000, { gear: 'P', speed_kph: 0 })
      off(125000) // power off ends the trip

      const t = published(TRIP)[0]
      expect(t.distance_km).toBeNull() // never last-first = 0
      expect(t.efficiency_wh_per_km).toBeNull() // guarded against Infinity/NaN
    })

    it('reports approximate distance with low odometer_coverage for interior readings', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60, cum_out_kwh: 100, cum_in_kwh: 10 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58, cum_out_kwh: 102, cum_in_kwh: 10 })
      odo(60000, 1000) // interior readings only
      odo(90000, 1040)
      bms(120000, { ignition: 1, speed_kph: 40, soc: 56, cum_out_kwh: 104, cum_in_kwh: 10 })
      vmcu(125000, { gear: 'P', speed_kph: 0 })
      off(125000) // power off ends the trip

      const t = published(TRIP)[0]
      expect(t.distance_km).toBeCloseTo(40, 5)
      expect(t.odometer_coverage).toBeLessThan(0.5) // 30s span of a 120s trip
    })

    it('nulls a metric on a negative counter delta (reset) and marks incomplete', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60, cum_out_kwh: 100 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58, cum_out_kwh: 98 }) // counter went DOWN
      bms(120000, { ignition: 1, speed_kph: 40, soc: 56, cum_out_kwh: 95 })
      vmcu(125000, { gear: 'P', speed_kph: 0 })
      off(125000) // power off ends the trip

      const t = published(TRIP)[0]
      expect(t.energy_out_kwh).toBeNull()
      expect(t.complete).toBe(false)
    })

    it('does NOT null a large but legitimate jump (60 km trip, 10 kWh charge)', () => {
      bms(0, { ignition: 1, speed_kph: 90, soc: 90, cum_out_kwh: 100, cum_in_kwh: 20 })
      odo(0, 1000)
      bms(60000, { ignition: 1, speed_kph: 90, soc: 70, cum_out_kwh: 110, cum_in_kwh: 20 })
      odo(60000, 1060) // +60 km, legitimate
      vmcu(65000, { gear: 'P', speed_kph: 0 })
      off(65000) // power off ends the trip

      const t = published(TRIP)[0]
      expect(t.distance_km).toBeCloseTo(60, 5) // 60 < maxPlausibleStepKm (400)
      expect(t.energy_out_kwh).toBeCloseTo(10, 5) // 10 < maxPlausibleStepKwh (40)
      expect(t.complete).toBe(true)
    })

    it('marks a rest incomplete with null soc when the pre-gap boundary is missing', async () => {
      // Bot started mid-gap: an open rest exists but its start snapshot is null.
      const cache = makeCache()
      cache.open = {
        kind: 'rest',
        start_ts: BASE + 100000,
        startSnapshot: { soc: null, cum_out_kwh: null, cum_in_kwh: null, cum_chg_ah: null, odometer: null, aux_12v: null, connector: null, ambient: null, ts: null },
        lastSnapshot: { soc: null, cum_out_kwh: null, cum_in_kwh: null, cum_chg_ah: null, odometer: null, aux_12v: null, connector: null, ambient: null, ts: null },
        lastRxTs: BASE + 100000,
        end_ts: BASE + 100000,
        sampleCount: 0,
        maxGapMs: 0,
        connectorSeen1: false,
        connectorSeenAny: false,
        aux12vStart: null,
        emitted: false
      }
      mqtt = makeMqtt()
      await start(cache)
      bms(500000, { ignition: 1, speed_kph: 5, soc: 84, cum_in_kwh: 30 })

      const parks = published(PARK)
      expect(parks).toHaveLength(1)
      expect(parks[0].complete).toBe(false)
      expect(parks[0].soc_start).toBeNull()
    })

    it('ignores malformed / partial payloads without corrupting state', () => {
      bms(0, null)
      bms(1000, {})
      bms(2000, { foo: 'bar' })
      vmcu(3000, { nogear: true })
      expect(mqtt.publish).not.toHaveBeenCalled()
      expect(persistedCache.open).toBeNull()
    })
  })

  describe('restart safety (lazy close)', () => {
    const openRestCache = (extra = {}) => {
      const cache = makeCache()
      cache.open = {
        kind: 'rest',
        start_ts: BASE + 120000,
        startSnapshot: { soc: 52, cum_out_kwh: 104, cum_in_kwh: 20, cum_chg_ah: 100, odometer: 1040, aux_12v: 12.8, connector: 1, ambient: null, ts: BASE + 120000 },
        lastSnapshot: { soc: 52, cum_out_kwh: 104, cum_in_kwh: 20, cum_chg_ah: 100, odometer: 1040, aux_12v: 12.8, connector: 1, ambient: null, ts: BASE + 120000 },
        lastRxTs: BASE + 120000,
        end_ts: BASE + 120000,
        sampleCount: 0,
        maxGapMs: 0,
        coverageSamples: 0,
        coverageFirstTs: null,
        coverageLastTs: null,
        connectorEdges: [],
        connectorPrev: 1,
        connectorSeen1: true,
        connectorSeenAny: true,
        aux12vStart: 12.8,
        emitted: false
      }
      return { ...cache, ...extra }
    }

    it('preserves an unbounded charge across a mid-gap restart; stationary resume does not split', async () => {
      mqtt = makeMqtt()
      await start(openRestCache())
      // stationary resume after restart must NOT close/split the rest
      bms(500000, { ignition: 1, speed_kph: 0, soc: 84, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })
      expect(published(CHARGE)).toHaveLength(0)
      expect(published(PARK)).toHaveLength(0)
      // motion resume closes it as ONE charge (delta from persisted pre-gap snapshot)
      bms(510000, { ignition: 1, speed_kph: 5, soc: 84, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const charges = published(CHARGE)
      expect(charges).toHaveLength(1)
      expect(charges[0].energy_in_kwh).toBeCloseTo(10.1, 5)
      expect(charges[0].bounds).toBe('unbounded') // sleep gap -> no awake/connector coverage
      expect(charges[0].power_avg_kw).toBeNull() // no fabricated drive-to-drive rate
      expect(charges[0].closed_by).toBe('restart_lazy_close')
      expect(published(PARK)).toHaveLength(0)
    })

    it('keeps bounds:meter when the persisted on-edge survives a mid-charge restart', async () => {
      const cache = openRestCache()
      cache.meterEdges = [{ type: 'on', ts: BASE + 200000, act: 1000 }]
      cache.meterState = { on: true, aboveSince: null, aboveAct: null, belowSince: null, belowAct: null }
      mqtt = makeMqtt()
      await start(cache)
      // meter turns off after the restart -> off edge
      meter(300000, 0, 1012.46)
      meter(420000, 0, 1012.46)
      bms(430000, { ignition: 1, speed_kph: 5, soc: 84, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const charges = published(CHARGE)
      expect(charges).toHaveLength(1)
      expect(charges[0].bounds).toBe('meter')
      expect(charges[0].ac_energy_kwh).toBeCloseTo(12.46, 5)
    })

    it('does not mislabel a normal close long after a restart (live trip -> ignition_off)', async () => {
      // Restart with an OPEN trip; the car keeps driving (goes live), then parks
      // normally much later. That close is ignition_off, not restart_lazy_close.
      const cache = makeCache()
      cache.open = {
        kind: 'trip',
        start_ts: BASE + 0,
        startSnapshot: { soc: 60, cum_out_kwh: 100, cum_in_kwh: 10, cum_chg_ah: 5, odometer: 1000, aux_12v: 13, connector: null, ambient: null, ts: BASE + 0 },
        motionSnapshot: { soc: 60, cum_out_kwh: 100, cum_in_kwh: 10, cum_chg_ah: 5, odometer: 1000, aux_12v: 13, connector: null, ambient: null, ts: BASE + 0 },
        lastMotionTs: BASE + 0,
        lastSnapshot: { soc: 60, cum_out_kwh: 100, cum_in_kwh: 10, cum_chg_ah: 5, odometer: 1000, aux_12v: 13, connector: null, ambient: null, ts: BASE + 0 },
        lastRxTs: BASE + 0,
        sampleCount: 1,
        maxGapMs: 0,
        speedSum: 40, speedCount: 1, speedMax: 40, powerMax: 20,
        odometerReadings: [],
        regenCumIn: 0, prevCumIn: 10, prevConnector: null, containedPlugged: false,
        stationarySince: null, emitted: false
      }
      mqtt = makeMqtt()
      await start(cache)
      bms(30000, { ignition: 1, speed_kph: 45, soc: 58 }) // resumes moving -> live trip
      bms(90000, { ignition: 1, speed_kph: 45, soc: 56 })
      vmcu(95000, { gear: 'P', speed_kph: 0 }) // normal park close
      off(95000) // power off ends the trip

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].closed_by).toBe('ignition_off')
    })

    it('degrades gracefully to bounds:unbounded when the on-edge is absent, energy still valid', async () => {
      const cache = openRestCache() // no meter edges
      mqtt = makeMqtt()
      await start(cache)
      bms(430000, { ignition: 1, speed_kph: 5, soc: 84, cum_in_kwh: 30.1, cum_chg_ah: 127.5 })

      const charges = published(CHARGE)
      expect(charges).toHaveLength(1)
      expect(charges[0].bounds).toBe('unbounded')
      expect(charges[0].energy_in_kwh).toBeCloseTo(10.1, 5)
      expect(charges[0].power_avg_kw).toBeNull()
    })
  })

  describe('exactly-once & de-dup', () => {
    it('sets the de-dup marker BEFORE publishing (exactly-once mitigation)', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 56 })
      vmcu(125000, { gear: 'P', speed_kph: 0 })
      off(125000) // power off ends the trip

      const rec = mqtt._published.find((p) => p.topic === TRIP)
      expect(rec.lastEmittedAtPublish).toEqual({ kind: 'trip', start_ts: BASE + 0, end_ts: BASE + 125000, seq: 1 })
    })

    it('does not drop a rest whose start_ts equals the prior trip end_ts', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 60 })
      vmcu(122000, { gear: 'P', speed_kph: 0 }) // trip end_ts = 120000, rest start_ts = 120000
      off(122000) // power off ends the trip
      bms(500000, { ignition: 1, speed_kph: 5, soc: 60 }) // resume -> park

      const trips = published(TRIP)
      const parks = published(PARK)
      expect(trips).toHaveLength(1)
      expect(parks).toHaveLength(1)
      expect(trips[0].end_ts).toBe(BASE + 122000)
      expect(parks[0].start_ts).toBe(BASE + 122000)
    })
  })

  describe('silence timer', () => {
    it('closes a trailing trip at the last-sample time, not "now"', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(60000, { ignition: 1, speed_kph: 40, soc: 58 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 56 })
      jest.advanceTimersByTime(300000) // fires at fake-clock 420000

      const trips = published(TRIP)
      expect(trips).toHaveLength(1)
      expect(trips[0].closed_by).toBe('silence_timeout')
      expect(trips[0].end_ts).toBe(BASE + 120000) // last motion sample, not 420000
    })

    it('a late stationary straggler after the timer does not close a second session', () => {
      bms(0, { ignition: 1, speed_kph: 40, soc: 60 })
      bms(120000, { ignition: 1, speed_kph: 40, soc: 56 })
      jest.advanceTimersByTime(300000)
      // late stationary sample only refreshes the still-open rest snapshot
      bms(500000, { ignition: 1, speed_kph: 0, soc: 56 })
      expect(published(PARK)).toHaveLength(0)
      expect(published(CHARGE)).toHaveLength(0)
    })
  })
})
