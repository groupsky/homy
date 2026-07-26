const { describe, expect, it, jest, beforeEach, afterEach } = require('@jest/globals')
const createIoniqTpms = require('./ioniq-tpms')

const TPMS = 'ioniq/parsed/tpms'
const AMBIENT = 'ioniq/parsed/ambient'
const SPEED = 'ioniq/parsed/bms/2101'
const P = (name) => `ioniq/parsed/derived/${name}`

function makeMqtt () {
  const mqtt = {
    _callbacks: {},
    subscribe: jest.fn().mockImplementation((topic, cb) => {
      mqtt._callbacks[topic] = cb
      return Promise.resolve()
    }),
    publish: jest.fn().mockResolvedValue(),
    _trigger: (topic, message) =>
      mqtt._callbacks[topic] ? mqtt._callbacks[topic](message) : undefined
  }
  return mqtt
}

function makeCache () {
  return { lastRaw: null, wheelChangedAt: {} }
}

const config = { tpmsTopic: TPMS, ambientTopic: AMBIENT, speedTopics: [SPEED] }

// Realistic prod-derived sample (2026-07-15 routy). The real tpms frame nests each
// wheel: {"fl":{"psi":37,"c":37}, ...}. Cold-normalize to 15 °C @ 0.18 psi/°C.
// fl: 36.6 - 0.18*(35-15) = 33.0 ; fr: 35.2 - 0.18*(36-15) = 31.42
// rl: 35.6 - 0.18*(37-15) = 31.64 ; rr: 36.2 - 0.18*(37-15) = 32.24
function sample (overrides = {}) {
  return {
    _type: 'ioniq',
    group: 'tpms',
    state: 'active',
    ts: 1000,
    fl: { psi: 36.6, c: 35 },
    fr: { psi: 35.2, c: 36 },
    rl: { psi: 35.6, c: 37 },
    rr: { psi: 36.2, c: 37 },
    ...overrides
  }
}

// Fetch the payload published to a given derived topic (last call), or undefined.
function published (mqtt, name) {
  const calls = mqtt.publish.mock.calls.filter((c) => c[0] === P(name))
  return calls.length ? calls[calls.length - 1][1] : undefined
}
function publishedTopics (mqtt) {
  return mqtt.publish.mock.calls.map((c) => c[0])
}

describe('ioniq-tpms bot', () => {
  let mqtt, persistedCache, bot
  beforeEach(async () => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniqTpms('ioniq-tpms', config)
    await bot.start({ mqtt, persistedCache })
  })

  it('subscribes to the tpms and ambient topics', () => {
    expect(mqtt.subscribe).toHaveBeenCalledWith(TPMS, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(AMBIENT, expect.any(Function))
  })

  it('emits four per-wheel cold pressures with correct payload shape', async () => {
    await mqtt._trigger(TPMS, sample())
    expect(published(mqtt, 'tire_fl_psi_cold')).toEqual(expect.objectContaining({
      _type: 'ioniq', group: 'derived/tire_fl_psi_cold', state: 'active', ts: 1000, value: 33.0
    }))
    expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(31.42)
    expect(published(mqtt, 'tire_rl_psi_cold').value).toBe(31.64)
    expect(published(mqtt, 'tire_rr_psi_cold').value).toBe(32.24)
  })

  it('includes raw psi and used temp as extra fields', async () => {
    await mqtt._trigger(TPMS, sample())
    expect(published(mqtt, 'tire_fl_psi_cold')).toEqual(expect.objectContaining({ psi: 36.6, temp: 35 }))
  })

  it('emits tire_spread_psi = max - min of cold pressures', async () => {
    await mqtt._trigger(TPMS, sample())
    // max 33.0 (fl) - min 31.42 (fr) = 1.58
    expect(published(mqtt, 'tire_spread_psi')).toEqual(expect.objectContaining({
      _type: 'ioniq', group: 'derived/tire_spread_psi', value: 1.58
    }))
  })

  it('emits per-wheel temp_excess = wheel - mean(other three)', async () => {
    await mqtt._trigger(TPMS, sample())
    // fl: 35 - mean(36,37,37)= 35 - 36.6667 = -1.67
    expect(published(mqtt, 'tire_fl_temp_excess').value).toBe(-1.67)
    // fr: 36 - mean(35,37,37)= 36 - 36.3333 = -0.33
    expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-0.33)
    // rl: 37 - mean(35,36,37)= 37 - 36 = 1
    expect(published(mqtt, 'tire_rl_temp_excess').value).toBe(1)
    // rr: 37 - mean(35,36,37)= 37 - 36 = 1
    expect(published(mqtt, 'tire_rr_temp_excess').value).toBe(1)
  })

  it('falls back to ambient temp when a wheel temp is missing', async () => {
    await mqtt._trigger(AMBIENT, { c: 25 })
    await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
    // fl uses ambient 25: 36.6 - 0.18*(25-15) = 36.6 - 1.8 = 34.8
    expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(34.8)
    expect(published(mqtt, 'tire_fl_psi_cold').temp).toBe(25)
  })

  describe('active-only gating', () => {
    it.each(['parked', 'charging'])('emits nothing for state=%s', async (state) => {
      await mqtt._trigger(TPMS, sample({ state }))
      expect(mqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('frozen-duplicate dedupe', () => {
    it('skips an identical consecutive active sample', async () => {
      await mqtt._trigger(TPMS, sample({ ts: 1 }))
      const after = mqtt.publish.mock.calls.length
      expect(after).toBeGreaterThan(0)
      await mqtt._trigger(TPMS, sample({ ts: 2 })) // same readings, new ts
      expect(mqtt.publish.mock.calls.length).toBe(after)
    })

    it('re-emits when any reading changes', async () => {
      await mqtt._trigger(TPMS, sample({ ts: 1 }))
      const after = mqtt.publish.mock.calls.length
      await mqtt._trigger(TPMS, sample({ ts: 2, fl: { psi: 30.0, c: 35 } }))
      expect(mqtt.publish.mock.calls.length).toBeGreaterThan(after)
    })

    it('holds dedupe across restart via pre-seeded lastRaw', async () => {
      mqtt = makeMqtt()
      const raw = {
        'fl.psi': 36.6, 'fl.c': 35, 'fr.psi': 35.2, 'fr.c': 36,
        'rl.psi': 35.6, 'rl.c': 37, 'rr.psi': 36.2, 'rr.c': 37
      }
      persistedCache = { lastRaw: raw }
      bot = createIoniqTpms('ioniq-tpms', config)
      await bot.start({ mqtt, persistedCache })
      await mqtt._trigger(TPMS, sample()) // identical to seeded lastRaw
      expect(mqtt.publish).not.toHaveBeenCalled()
    })
  })

  describe('partial payloads', () => {
    it('omits a wheel with missing psi but still emits the others', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })

    it('excludes a psi-less wheel from spread', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      // remaining cold: fr 31.42, rl 31.64, rr 32.24 → spread 32.24-31.42 = 0.82
      expect(published(mqtt, 'tire_spread_psi').value).toBe(0.82)
    })

    it('still counts a psi-less-but-temp-present wheel in others temp_excess', async () => {
      // fl has temp 35 but no psi. fr temp_excess still uses fl's temp in the mean.
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-0.33)
    })

    it('emits no psi_cold for a wheel missing both its temp and any ambient', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
    })

    it('does not emit spread when fewer than two wheels are valid', async () => {
      await mqtt._trigger(TPMS, sample({
        fr: { c: 36 }, rl: { c: 37 }, rr: { c: 37 }
      }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_psi')).toBeUndefined()
    })

    it('does not emit temp_excess for a lone-temp wheel', async () => {
      await mqtt._trigger(TPMS, sample({
        fr: {}, rl: {}, rr: {}
      }))
      expect(publishedTopics(mqtt)).not.toContain(P('tire_fl_temp_excess'))
    })

    it('does not emit temp_excess for a wheel using only ambient fallback temp', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // fl still gets a cold pressure (via ambient) but no temp_excess (no own temp)
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_fl_temp_excess')).toBeUndefined()
    })

    it('excludes an ambient-fallback wheel from the others temp_excess mean', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // fr excess uses only fr,rl,rr real temps: 36 - mean(37,37) = 36 - 37 = -1
      expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-1)
    })

    it('ignores a non-finite ambient temp', async () => {
      await mqtt._trigger(AMBIENT, { c: 'n/a' })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // no valid temp for fl → no psi_cold
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
    })

    it('ignores an ambient reading older than 30 minutes', async () => {
      jest.useFakeTimers()
      try {
        await mqtt._trigger(AMBIENT, { c: 25 })
        jest.advanceTimersByTime(30 * 60 * 1000 + 1)
        await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
        // ambient is stale → no valid temp for fl → no psi_cold
        expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      } finally {
        jest.useRealTimers()
      }
    })

    it('still uses ambient just under the 30 minute staleness bound', async () => {
      jest.useFakeTimers()
      try {
        await mqtt._trigger(AMBIENT, { c: 25 })
        jest.advanceTimersByTime(30 * 60 * 1000 - 1)
        await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
        expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(34.8)
      } finally {
        jest.useRealTimers()
      }
    })

    it('tolerates a wheel key that is absent entirely', async () => {
      await mqtt._trigger(TPMS, sample({ fl: undefined }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })

    it('tolerates a wheel value that is not an object', async () => {
      await mqtt._trigger(TPMS, sample({ fl: 'n/a' }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })
  })

  // Regression: the bot originally read flat `payload['fl.psi']` while the real
  // frame nests each wheel, so it never published anything. This fixture is a
  // verbatim prod payload (routy, 2026-07-15) — keep it byte-faithful.
  describe('real prod payload', () => {
    const PROD = {
      _type: 'ioniq',
      group: 'tpms',
      state: 'active',
      ts: 1784140447039,
      seq: 11057,
      boot_id: '2b68df09-135e-43df-be6e-da17127c9725',
      fl: { psi: 37, c: 37 },
      fr: { psi: 35.4, c: 38 },
      rr: { psi: 36.2, c: 38 },
      rl: { psi: 35.8, c: 38 },
      raw: '62C00BFFFF0000B9570100B1580100B5580100B3580100',
      hdr: '7A0',
      req: '22C00B',
      _tz: 1784140447137,
      _ts: '2026-07-15T18:34:07.137Z'
    }

    it('emits all four cold pressures from a verbatim prod frame', async () => {
      await mqtt._trigger(TPMS, PROD)
      // fl: 37 - 0.18*(37-15) = 33.04 ; fr: 35.4 - 0.18*(38-15) = 31.26
      // rl: 35.8 - 0.18*(38-15) = 31.66 ; rr: 36.2 - 0.18*(38-15) = 32.06
      expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(33.04)
      expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(31.26)
      expect(published(mqtt, 'tire_rl_psi_cold').value).toBe(31.66)
      expect(published(mqtt, 'tire_rr_psi_cold').value).toBe(32.06)
    })

    it('emits spread and temp_excess from a verbatim prod frame', async () => {
      await mqtt._trigger(TPMS, PROD)
      // max 33.04 (fl) - min 31.26 (fr) = 1.78
      expect(published(mqtt, 'tire_spread_psi').value).toBe(1.78)
      // fl: 37 - mean(38,38,38) = -1
      expect(published(mqtt, 'tire_fl_temp_excess').value).toBe(-1)
    })

    it('does not mistake the payload hex `raw` string for wheel data', async () => {
      await mqtt._trigger(TPMS, PROD)
      expect(published(mqtt, 'tire_fl_psi_cold').psi).toBe(37)
    })
  })

  // ---------------------------------------------------------------------------
  // Regression: issue #1415 — the four TPMS values in a frame are NOT
  // contemporaneous. The car latches each wheel's last received value, and the
  // sensors only transmit while the wheel turns, so after a long park the set
  // steps from stale to fresh one wheel at a time. The wheel that refreshes last
  // briefly looks 10-15 °C hotter than its already-refreshed peers.
  // ---------------------------------------------------------------------------

  const MIN = 60 * 1000
  const HOUR = 60 * MIN

  // Build a tpms frame from a {fl,fr,rl,rr} temperature map. A TPMS sensor
  // transmits pressure and temperature in the same burst, so psi is derived from
  // the temperature here: a wheel that refreshes changes both fields, exactly as
  // the prod frames do.
  function frame (ts, temps, extra = {}) {
    const f = { _type: 'ioniq', group: 'tpms', state: 'active', ts, ...extra }
    for (const [w, c] of Object.entries(temps)) {
      f[w] = { psi: Math.round((33 + 0.18 * (c - 15)) * 10) / 10, c }
    }
    return f
  }

  // Every temp_excess value published so far, in order.
  function excessValues (mqtt) {
    return mqtt.publish.mock.calls
      .filter((c) => /_temp_excess$/.test(c[0]))
      .map((c) => c[1].value)
  }

  function excessCount (mqtt) {
    return mqtt.publish.mock.calls.filter((c) => /_temp_excess$/.test(c[0])).length
  }

  describe('per-wheel freshness gate (issue #1415 replays)', () => {
    it('emits no temp_excess breach replaying the 2026-07-25 wake-up', async () => {
      // Stale set held since the 07-22 drive, then a V2L wake-up refreshes
      // rl, fr, fl, rr in that order over ~6 minutes. RR lags three samples and
      // peaked at +12.33 °C under the old logic.
      const t0 = Date.UTC(2026, 6, 25, 7, 0, 55)
      await mqtt._trigger(TPMS, frame(t0, { fl: 28, fr: 29, rl: 31, rr: 30 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 25, 14, 1, 0), { fl: 28, fr: 29, rl: 19, rr: 30 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 25, 14, 3, 26), { fl: 28, fr: 16, rl: 19, rr: 30 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 25, 14, 4, 12), { fl: 18, fr: 16, rl: 19, rr: 30 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 25, 14, 6, 43), { fl: 18, fr: 16, rl: 19, rr: 18 }))

      expect(Math.max(...excessValues(mqtt))).toBeLessThanOrEqual(8)
      // ...and specifically nothing at all while the set was mixed stale/fresh.
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBe(0.33)
    })

    it('emits no temp_excess breach replaying the 2026-07-16 wake-up', async () => {
      // Bulk 38 -> 22/23 step with RL lagging one sample (peaked +15.33 °C).
      const t0 = Date.UTC(2026, 6, 15, 18, 30, 0)
      await mqtt._trigger(TPMS, frame(t0, { fl: 38, fr: 38, rl: 38, rr: 38 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 16, 4, 55, 0), { fl: 22, fr: 23, rl: 38, rr: 23 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 16, 4, 56, 0), { fl: 22, fr: 23, rl: 22, rr: 23 }))

      expect(Math.max(...excessValues(mqtt))).toBeLessThanOrEqual(8)
    })

    it('emits no temp_excess breach replaying the 2026-07-20 wake-up', async () => {
      // Bulk 33/34 -> 22/23 step with FR lagging one sample (peaked +10.33 °C).
      const t0 = Date.UTC(2026, 6, 19, 19, 0, 0)
      await mqtt._trigger(TPMS, frame(t0, { fl: 33, fr: 34, rl: 34, rr: 34 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 20, 5, 18, 0), { fl: 23, fr: 34, rl: 24, rr: 24 }))
      await mqtt._trigger(TPMS, frame(Date.UTC(2026, 6, 20, 5, 19, 0), { fl: 23, fr: 23, rl: 24, rr: 24 }))

      expect(Math.max(...excessValues(mqtt))).toBeLessThanOrEqual(8)
    })

    it('suppresses only temp_excess — psi_cold and spread still publish', async () => {
      const t0 = Date.UTC(2026, 6, 25, 7, 0, 55)
      await mqtt._trigger(TPMS, frame(t0, { fl: 28, fr: 29, rl: 31, rr: 30 }))
      mqtt.publish.mockClear()
      // One wheel refreshes 7 hours later — the rest are stale.
      await mqtt._trigger(TPMS, frame(t0 + 7 * HOUR, { fl: 28, fr: 29, rl: 19, rr: 30 }))
      expect(excessCount(mqtt)).toBe(0)
      expect(published(mqtt, 'tire_rl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_psi')).toBeDefined()
    })

    it('resumes temp_excess once every wheel has refreshed inside the window', async () => {
      const t0 = 0
      await mqtt._trigger(TPMS, frame(t0, { fl: 28, fr: 29, rl: 31, rr: 30 }))
      await mqtt._trigger(TPMS, frame(t0 + 7 * HOUR, { fl: 20, fr: 29, rl: 31, rr: 30 }))
      await mqtt._trigger(TPMS, frame(t0 + 7 * HOUR + MIN, { fl: 20, fr: 21, rl: 31, rr: 30 }))
      mqtt.publish.mockClear()
      await mqtt._trigger(TPMS, frame(t0 + 7 * HOUR + 2 * MIN, { fl: 20, fr: 21, rl: 22, rr: 23 }))
      // fl 20 / fr 21 / rl 22 / rr 23 all changed within 2 minutes of each other.
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBe(2)
    })

    it('honours a configured wheelFreshnessWindowMs', async () => {
      mqtt = makeMqtt()
      persistedCache = makeCache()
      bot = createIoniqTpms('ioniq-tpms', { ...config, wheelFreshnessWindowMs: 8 * HOUR })
      await bot.start({ mqtt, persistedCache })
      await mqtt._trigger(TPMS, frame(0, { fl: 28, fr: 29, rl: 31, rr: 30 }))
      mqtt.publish.mockClear()
      // 7 h apart — outside the 10 min default, inside the configured 8 h window.
      await mqtt._trigger(TPMS, frame(7 * HOUR, { fl: 28, fr: 29, rl: 19, rr: 30 }))
      expect(excessCount(mqtt)).toBeGreaterThan(0)
    })

    it('tolerates a persisted cache written before wheelChangedAt existed', async () => {
      mqtt = makeMqtt()
      persistedCache = { lastRaw: null } // v1 shape
      bot = createIoniqTpms('ioniq-tpms', config)
      await bot.start({ mqtt, persistedCache })
      await mqtt._trigger(TPMS, frame(0, { fl: 28, fr: 29, rl: 31, rr: 30 }))
      expect(excessCount(mqtt)).toBeGreaterThan(0)
    })

    it('declares a persistedCache migration for the new wheelChangedAt map', () => {
      const spec = createIoniqTpms('ioniq-tpms', config).persistedCache
      expect(spec.version).toBeGreaterThan(1)
      expect(spec.default).toHaveProperty('wheelChangedAt')
      const migrated = spec.migrate({
        version: 1, defaultState: spec.default, state: { lastRaw: null }
      })
      expect(migrated.wheelChangedAt).toEqual({})
    })
  })

  describe('motion gate (issue #1415)', () => {
    // A dragging brake or a failing bearing only heats a wheel while it rolls,
    // so a cross-wheel temperature comparison at standstill is meaningless.
    const hotFrame = (ts) => frame(ts, { fl: 30, fr: 31, rl: 30, rr: 45 })

    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.useRealTimers() })

    it('suppresses temp_excess when fresh telemetry says the car is standing still', async () => {
      await mqtt._trigger(SPEED, { speed_kph: 0 })
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      expect(excessCount(mqtt)).toBe(0)
      expect(published(mqtt, 'tire_rr_psi_cold')).toBeDefined()
    })

    it('suppresses temp_excess when the last motion is older than motionMaxAgeMs', async () => {
      await mqtt._trigger(SPEED, { speed_kph: 60 })
      jest.advanceTimersByTime(31 * MIN)
      await mqtt._trigger(SPEED, { speed_kph: 0 })
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      expect(excessCount(mqtt)).toBe(0)
    })

    it('derives temp_excess for a genuinely hot wheel while driving', async () => {
      // All four wheels refresh every minute; rr climbs away from its peers.
      const temps = [
        { fl: 30, fr: 31, rl: 30, rr: 32 },
        { fl: 31, fr: 32, rl: 31, rr: 38 },
        { fl: 32, fr: 33, rl: 32, rr: 44 },
        { fl: 33, fr: 34, rl: 33, rr: 50 }
      ]
      for (const t of temps) {
        await mqtt._trigger(SPEED, { speed_kph: 55 })
        await mqtt._trigger(TPMS, frame(Date.now(), t))
        jest.advanceTimersByTime(MIN)
      }
      // rr 50 - mean(33,34,33) = 50 - 33.33 = 16.67
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBe(16.67)
    })

    it('keeps deriving while motion is still recent after stopping', async () => {
      await mqtt._trigger(SPEED, { speed_kph: 55 })
      jest.advanceTimersByTime(5 * MIN)
      await mqtt._trigger(SPEED, { speed_kph: 0 })
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBeGreaterThan(8)
    })

    it('fails open when no speed telemetry has ever arrived', async () => {
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBeGreaterThan(8)
    })

    it('fails open when the speed telemetry itself is stale', async () => {
      await mqtt._trigger(SPEED, { speed_kph: 0 })
      jest.advanceTimersByTime(61 * MIN)
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBeGreaterThan(8)
    })

    it('ignores a speed payload without a usable speed_kph', async () => {
      await mqtt._trigger(SPEED, { speed_kph: 'n/a' })
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      // nothing usable was learned, so the gate still fails open
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBeGreaterThan(8)
    })

    it('subscribes to every configured speed topic', async () => {
      mqtt = makeMqtt()
      persistedCache = makeCache()
      bot = createIoniqTpms('ioniq-tpms', {
        ...config, speedTopics: ['ioniq/parsed/bms/2101', 'ioniq/parsed/vmcu']
      })
      await bot.start({ mqtt, persistedCache })
      expect(mqtt.subscribe).toHaveBeenCalledWith('ioniq/parsed/bms/2101', expect.any(Function))
      expect(mqtt.subscribe).toHaveBeenCalledWith('ioniq/parsed/vmcu', expect.any(Function))
    })

    it('disables the motion gate when speedTopics is empty', async () => {
      mqtt = makeMqtt()
      persistedCache = makeCache()
      bot = createIoniqTpms('ioniq-tpms', { ...config, speedTopics: [] })
      await bot.start({ mqtt, persistedCache })
      await mqtt._trigger(TPMS, hotFrame(Date.now()))
      expect(published(mqtt, 'tire_rr_temp_excess').value).toBeGreaterThan(8)
    })
  })
})
