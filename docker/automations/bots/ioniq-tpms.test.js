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
// wheel: {"fl":{"psi":37,"c":37}, ...}. Cold-normalize to 15 °C with the gas law
// (issue #1479): psi_cold = (psi + 14.6959)·288.15/(c + 273.15) − 14.6959.
// fl: 33.27 ; fr: 31.81 ; rl: 32.03 ; rr: 32.59
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
      _type: 'ioniq', group: 'derived/tire_fl_psi_cold', state: 'active', ts: 1000, value: 33.27
    }))
    expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(31.81)
    expect(published(mqtt, 'tire_rl_psi_cold').value).toBe(32.03)
    expect(published(mqtt, 'tire_rr_psi_cold').value).toBe(32.59)
  })

  it('includes raw psi and used temp as extra fields', async () => {
    await mqtt._trigger(TPMS, sample())
    expect(published(mqtt, 'tire_fl_psi_cold')).toEqual(expect.objectContaining({ psi: 36.6, temp: 35 }))
  })

  it('emits tire_spread_psi = max - min of cold pressures', async () => {
    await mqtt._trigger(TPMS, sample())
    // max 33.27 (fl) - min 31.81 (fr) = 1.46
    expect(published(mqtt, 'tire_spread_psi')).toEqual(expect.objectContaining({
      _type: 'ioniq', group: 'derived/tire_spread_psi', value: 1.46
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
    // fl uses ambient 25: (36.6+14.6959)*288.15/298.15 - 14.6959 = 34.88
    expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(34.88)
    expect(published(mqtt, 'tire_fl_psi_cold').temp).toBe(25)
  })

  // ---------------------------------------------------------------------------
  // Issue #1478: the owner reads tyre pressures in bar, so a parallel bar series
  // is published next to the psi one and everything downstream moved onto it.
  // The psi series keeps writing so its existing history stays continuous.
  // ---------------------------------------------------------------------------
  describe('bar output (issue #1478)', () => {
    it('emits a bar cold pressure for every wheel alongside the psi one', async () => {
      await mqtt._trigger(TPMS, sample())
      // 33.27 / 14.5038 = 2.2939 ; 31.81 -> 2.1932 ; 32.03 -> 2.2085 ; 32.59 -> 2.2470
      expect(published(mqtt, 'tire_fl_bar_cold')).toEqual(expect.objectContaining({
        _type: 'ioniq', group: 'derived/tire_fl_bar_cold', state: 'active', ts: 1000, value: 2.294
      }))
      expect(published(mqtt, 'tire_fr_bar_cold').value).toBe(2.193)
      expect(published(mqtt, 'tire_rl_bar_cold').value).toBe(2.209)
      expect(published(mqtt, 'tire_rr_bar_cold').value).toBe(2.247)
    })

    it('leaves the psi series byte-identical when the bar series is added', async () => {
      await mqtt._trigger(TPMS, sample())
      expect(published(mqtt, 'tire_fl_psi_cold')).toEqual({
        _type: 'ioniq',
        group: 'derived/tire_fl_psi_cold',
        state: 'active',
        ts: 1000,
        value: 33.27,
        psi: 36.6,
        temp: 35
      })
      expect(published(mqtt, 'tire_spread_psi').value).toBe(1.46)
    })

    // The gas law almost never lands on a clean 2-decimal figure, so this pins
    // that the rounding still happens at the call site rather than in `publish`
    // (psi and bar round to different precisions). Unrounded, fr here is
    // 31.703437... and the spread 1.6295...
    it('still rounds the psi series to 2 decimals on values with float residue', async () => {
      await mqtt._trigger(TPMS, sample({
        fl: { psi: 37, c: 37 },
        fr: { psi: 35.4, c: 38 },
        rl: { psi: 35.8, c: 38 },
        rr: { psi: 36.2, c: 38 }
      }))
      expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(31.7)
      expect(published(mqtt, 'tire_rl_psi_cold').value).toBe(32.07)
      expect(published(mqtt, 'tire_spread_psi').value).toBe(1.64)
    })

    // The two units are derived from one unrounded figure, so the published
    // pair must always agree to within the rounding of the coarser one.
    it('keeps every bar value consistent with its psi twin', async () => {
      await mqtt._trigger(TPMS, sample())
      for (const w of ['fl', 'fr', 'rl', 'rr']) {
        const psi = published(mqtt, `tire_${w}_psi_cold`).value
        const bar = published(mqtt, `tire_${w}_bar_cold`).value
        expect(bar * 14.5038).toBeCloseTo(psi, 1)
      }
      expect(published(mqtt, 'tire_spread_bar').value * 14.5038)
        .toBeCloseTo(published(mqtt, 'tire_spread_psi').value, 1)
    })

    it('carries the raw pressure in bar and the temperature used', async () => {
      await mqtt._trigger(TPMS, sample())
      // raw 36.6 psi / 14.5038 = 2.5235 bar
      expect(published(mqtt, 'tire_fl_bar_cold')).toEqual(expect.objectContaining({
        bar: 2.523, temp: 35
      }))
      expect(published(mqtt, 'tire_fl_bar_cold')).not.toHaveProperty('psi')
    })

    it('emits tire_spread_bar = max - min of the cold pressures in bar', async () => {
      await mqtt._trigger(TPMS, sample())
      // 1.46 psi / 14.5038 = 0.1007 bar
      expect(published(mqtt, 'tire_spread_bar')).toEqual(expect.objectContaining({
        _type: 'ioniq', group: 'derived/tire_spread_bar', value: 0.101
      }))
    })

    // 3 decimals, not 2 — see the rounding note in the bot. At 2 decimals the
    // bar series would quantise to 0.145 psi, adding up to 0.07 psi on top of
    // the error the 2-decimal thresholds already carry.
    it('keeps three decimals of resolution', async () => {
      // (34.9+14.6959)*288.15/308.15 - 14.6959 = 31.6775 psi -> 2.18410... bar
      await mqtt._trigger(TPMS, sample({ fl: { psi: 34.9, c: 35 } }))
      expect(published(mqtt, 'tire_fl_bar_cold').value).toBe(2.184)
    })

    it('omits the bar series for a wheel with no usable pressure', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      expect(published(mqtt, 'tire_fl_bar_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_bar_cold')).toBeDefined()
      // remaining cold: fr 31.81, rl 32.03, rr 32.59 -> 0.78 psi -> 0.0538 bar
      expect(published(mqtt, 'tire_spread_bar').value).toBe(0.054)
    })

    it('does not emit tire_spread_bar when fewer than two wheels are valid', async () => {
      await mqtt._trigger(TPMS, sample({
        fr: { c: 36 }, rl: { c: 37 }, rr: { c: 37 }
      }))
      expect(published(mqtt, 'tire_fl_bar_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_bar')).toBeUndefined()
    })

    it('uses the ambient fallback temperature for the bar series too', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // (36.6+14.6959)*288.15/298.15 - 14.6959 = 34.8834 psi -> 2.4051 bar
      expect(published(mqtt, 'tire_fl_bar_cold').value).toBe(2.405)
      expect(published(mqtt, 'tire_fl_bar_cold').temp).toBe(25)
    })
  })

  // ---------------------------------------------------------------------------
  // Issue #1479: the under-inflation alerts moved off the continuously-published
  // normalised series onto one point per morning, taken from the first fresh
  // frame after a long park — a genuinely cold tyre, directly comparable to the
  // placard, and evaluated once so it cannot flap across the trip point.
  // ---------------------------------------------------------------------------
  describe('cold-start pressure (issue #1479)', () => {
    // Local wall-clock, not UTC: "first start of the day" is a statement about
    // the owner's morning, and the bot keys the day in the process timezone.
    // Building the timestamps the same way keeps this test timezone-independent.
    const at = (day, h, m = 0, s = 0) => new Date(2026, 7, day, h, m, s).getTime()

    // Latched overnight values: the last thing each sensor said on the evening
    // drive, still being replayed by the car.
    const STALE = {
      fl: { psi: 36.4, c: 40 }, fr: { psi: 35.4, c: 41 },
      rl: { psi: 35.8, c: 40 }, rr: { psi: 36.2, c: 41 }
    }
    // Verbatim first-fresh values from the 2026-08-04 05:17Z wake-up on routy.
    const FRESH_FR = { psi: 31.2, c: 19 }
    const FRESH_FL = { psi: 32.8, c: 19 }

    const tpms = (ts, wheels) => ({
      _type: 'ioniq', group: 'tpms', state: 'active', ts, ...STALE, ...wheels
    })

    // Seed the per-wheel last-changed map so a following frame has a park length
    // to measure against. A cold cache has none and deliberately publishes nothing.
    const seed = (ts) => mqtt._trigger(TPMS, tpms(ts, {}))

    const coldstarts = (m) => m.publish.mock.calls
      .filter((c) => /_bar_coldstart$/.test(c[0]))
      .map((c) => [c[0], c[1].value])

    it('publishes the first fresh frame after an overnight park', async () => {
      await seed(at(4, 20, 0))
      await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
      // 31.2 psi / 14.5038 = 2.15117 bar — raw, not compensated.
      expect(published(mqtt, 'tire_fr_bar_coldstart')).toEqual({
        _type: 'ioniq',
        group: 'derived/tire_fr_bar_coldstart',
        state: 'active',
        ts: at(5, 5, 17),
        value: 2.151,
        bar: 2.151,
        temp: 19
      })
    })

    it('publishes the raw reading, with no temperature compensation applied', async () => {
      await seed(at(4, 20, 0))
      await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
      // 31.2 psi / 14.5038 = 2.151 bar, the reading exactly as the sensor gave
      // it. The normalised series drags the same 19 °C reading down to its 15 °C
      // reference and lands at 2.108 — 0.043 bar lower. That gap is defect 1:
      // the placard is defined at ambient, so 19 °C *is* the condition to
      // compare at, and the coldstart series must leave the reading alone.
      expect(published(mqtt, 'tire_fr_bar_coldstart').value).toBe(2.151)
      expect(published(mqtt, 'tire_fr_bar_coldstart').bar).toBe(2.151)
      expect(published(mqtt, 'tire_fr_bar_cold').value).toBe(2.108)
    })

    describe('long-park gate', () => {
      it('publishes after a park just over the six hour bound', async () => {
        await seed(at(5, 5, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 11, 1), { fr: FRESH_FR }))
        expect(published(mqtt, 'tire_fr_bar_coldstart')).toBeDefined()
      })

      it('publishes nothing after a park just under it', async () => {
        await seed(at(5, 5, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 10, 59), { fr: FRESH_FR }))
        expect(published(mqtt, 'tire_fr_bar_coldstart')).toBeUndefined()
      })

      it('publishes nothing for a wheel refreshing every few minutes mid-drive', async () => {
        await seed(at(5, 12, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 12, 2), { fr: { psi: 34, c: 34 } }))
        await mqtt._trigger(TPMS, tpms(at(5, 12, 5), { fr: { psi: 34.4, c: 37 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('honours a configured coldstartMinParkMs', async () => {
        mqtt = makeMqtt()
        persistedCache = makeCache()
        bot = createIoniqTpms('ioniq-tpms', { ...config, coldstartMinParkMs: 2 * HOUR })
        await bot.start({ mqtt, persistedCache })
        await mqtt._trigger(TPMS, tpms(at(5, 5, 0), {}))
        await mqtt._trigger(TPMS, tpms(at(5, 8, 0), { fr: FRESH_FR }))
        expect(published(mqtt, 'tire_fr_bar_coldstart')).toBeDefined()
      })

      it('publishes nothing on a cold cache, where the park length is unknown', async () => {
        // The very first frame after a fresh install may be a true cold reading
        // or a mid-drive one — with no previous frame to diff against, every
        // wheel merely *looks* refreshed, so it waits for tomorrow morning
        // rather than alerting on a guess.
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      // The two halves of "the park length is unknown" fail closed
      // independently, so each needs the other half held valid to be pinned.
      it('publishes nothing with per-wheel timestamps but no previous frame', async () => {
        // Reachable from a hand-seeded or partially-written cache. Every wheel
        // reports "changed" against a null lastRaw, so without this guard all
        // four would publish whatever the frame happened to carry.
        mqtt = makeMqtt()
        persistedCache = {
          lastRaw: null,
          wheelChangedAt: { fl: at(4, 20, 0), fr: at(4, 20, 0), rl: at(4, 20, 0), rr: at(4, 20, 0) },
          coldstartDay: {}
        }
        bot = createIoniqTpms('ioniq-tpms', config)
        await bot.start({ mqtt, persistedCache })
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('publishes nothing for a wheel that has no last-changed time yet', async () => {
        // rr has never been seen changing — `frameTs - undefined` is NaN, and
        // NaN < 6h is false, so without the finite check the park gate would
        // *pass* and an unknown-park reading would publish.
        mqtt = makeMqtt()
        persistedCache = {
          lastRaw: {
            'fl.psi': 36.4, 'fl.c': 40, 'fr.psi': 35.4, 'fr.c': 41,
            'rl.psi': 35.8, 'rl.c': 40, 'rr.psi': 36.2, 'rr.c': 41
          },
          wheelChangedAt: { fl: at(4, 20, 0), fr: at(4, 20, 0), rl: at(4, 20, 0) },
          coldstartDay: {}
        }
        bot = createIoniqTpms('ioniq-tpms', config)
        await bot.start({ mqtt, persistedCache })
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR, rr: { psi: 33.4, c: 20 } }))
        expect(coldstarts(mqtt)).toEqual([['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.151]])
      })
    })

    describe('evidence that the sensor actually spoke', () => {
      it('publishes nothing when the wheel was absent from the previous frame', async () => {
        // fl drops out of the last frame before the park, then reappears next
        // morning still carrying the value the car latched at the end of the
        // evening drive. The (psi, c) pair "changed", but only because it was
        // missing — the reading is 40 °C hot, and publishing it as a cold start
        // would report 2.510 bar and mute a genuine low-pressure alert.
        await seed(at(4, 19, 0))
        await mqtt._trigger(TPMS, tpms(at(4, 20, 0), { fl: { c: 40 } }))
        mqtt.publish.mockClear()
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fl: { psi: 36.4, c: 40 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('publishes nothing when the pressure is unchanged across the park', async () => {
        // Only the temperature moved. A tyre that has cooled over 6 h has always
        // moved at least one 0.2 psi step, so an unchanged pressure means the
        // car is replaying a latched value with a fresher temperature.
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: { psi: 35.4, c: 19 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })
    })

    describe('implausible readings', () => {
      // The value goes into an alerting series with a multi-day window, so a
      // failing sensor reporting 0 would page as CRITICAL and hold for days.
      it.each([
        ['a dead sensor reporting zero', 0],
        ['a stuck-high reading', 80]
      ])('publishes nothing for %s', async (_label, psi) => {
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: { psi, c: 19 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('leaves the day open for a later qualifying frame', async () => {
        // The day gate is consumed on publish, so rejecting must not consume it.
        // Note what the rejection does NOT undo: the bogus frame still stamps
        // `wheelChangedAt`, so the park clock restarts from it and the wheel has
        // to sit another six hours before it qualifies again. Fail-closed, and
        // an implausible reading is a broken sensor that will keep repeating
        // rather than recover minutes later — but it does mean one bad frame at
        // wake costs that wheel its reading unless the car parks up again.
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: { psi: 0, c: 0 } }))
        await mqtt._trigger(TPMS, tpms(at(5, 12, 0), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toEqual([['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.151]])
      })
    })

    describe('first-start-of-day gate', () => {
      it('publishes nothing for a second long park on the same day', async () => {
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toHaveLength(1)
        // Parked all day in the sun, driven again in the evening: over six hours
        // since fr last spoke, but the tyre is sun-soaked, not cold.
        mqtt.publish.mockClear()
        await mqtt._trigger(TPMS, tpms(at(5, 20, 0), { fr: { psi: 34.2, c: 38 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('publishes again the next morning', async () => {
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        mqtt.publish.mockClear()
        await mqtt._trigger(TPMS, tpms(at(6, 5, 20), { fr: { psi: 31, c: 18 } }))
        expect(coldstarts(mqtt)).toEqual([['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.137]])
      })

      it('publishes once after a multi-day park', async () => {
        await seed(at(2, 18, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toHaveLength(1)
      })
    })

    describe('first frame, not an average of the first few', () => {
      it('takes the first fresh value and ignores the wheel warming afterwards', async () => {
        // Verbatim 2026-08-04: fr climbs 31.2 -> 32.2 in the three minutes after
        // wake as the tyre picks up heat. Averaging those would read 0.07 bar high.
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17, 22), { fr: { psi: 31.2, c: 19 } }))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 18, 41), { fr: { psi: 31.4, c: 19 } }))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 19, 12), { fr: { psi: 31.6, c: 19 } }))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 20, 12), { fr: { psi: 32.2, c: 21 } }))
        expect(coldstarts(mqtt)).toEqual([['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.151]])
      })
    })

    describe('staggered per-wheel wake-up', () => {
      it('publishes each wheel on its own first fresh frame', async () => {
        // Verbatim 2026-08-04 05:17Z: fr refreshed a whole frame before fl, while
        // fl was still replaying the 36.4 psi / 40 °C it latched the night before.
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17, 22), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toEqual([['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.151]])
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17, 41), { fr: FRESH_FR, fl: FRESH_FL }))
        // fl joins with its own reading; fr is not republished.
        expect(coldstarts(mqtt)).toEqual([
          ['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.151],
          ['ioniq/parsed/derived/tire_fl_bar_coldstart', 2.261]
        ])
      })

      it('does not let an early wheel consume the day for the others', async () => {
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17, 22), { fr: FRESH_FR }))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17, 41), { fr: FRESH_FR, fl: FRESH_FL }))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 18, 22), {
          fr: FRESH_FR, fl: FRESH_FL, rl: { psi: 33, c: 20 }, rr: { psi: 33.4, c: 20 }
        }))
        expect(coldstarts(mqtt).map((c) => c[0])).toEqual([
          P('tire_fr_bar_coldstart'), P('tire_fl_bar_coldstart'),
          P('tire_rl_bar_coldstart'), P('tire_rr_bar_coldstart')
        ])
      })

      it('skips a wheel whose fresh frame carries no pressure', async () => {
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: { c: 19 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('omits temp when the fresh frame carries no wheel temperature', async () => {
        await seed(at(4, 20, 0))
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: { psi: 31.2 } }))
        expect(published(mqtt, 'tire_fr_bar_coldstart')).not.toHaveProperty('temp')
        expect(published(mqtt, 'tire_fr_bar_coldstart').value).toBe(2.151)
      })
    })

    describe('restart with a warm persisted cache', () => {
      // What the bot actually writes out: the last frame it processed, plus the
      // per-wheel timestamps. The pair matters — `lastRaw` is what tells the next
      // frame which wheels genuinely refreshed.
      const STALE_RAW = {
        'fl.psi': 36.4, 'fl.c': 40, 'fr.psi': 35.4, 'fr.c': 41,
        'rl.psi': 35.8, 'rl.c': 40, 'rr.psi': 36.2, 'rr.c': 41
      }
      const allAt = (ts) => ({ fl: ts, fr: ts, rl: ts, rr: ts })
      const restart = async (cache) => {
        mqtt = makeMqtt()
        persistedCache = { lastRaw: STALE_RAW, ...cache }
        bot = createIoniqTpms('ioniq-tpms', config)
        await bot.start({ mqtt, persistedCache })
      }

      it('publishes nothing when the cache says every wheel spoke minutes ago', async () => {
        // Restarted mid-drive: the tyres are hot and nothing about the restart
        // makes the next frame a cold reading.
        await restart({ wheelChangedAt: allAt(at(5, 12, 0)), coldstartDay: {} })
        await mqtt._trigger(TPMS, tpms(at(5, 12, 4), { fr: { psi: 34.4, c: 37 } }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('still publishes when the cache carries a genuine overnight gap', async () => {
        await restart({ wheelChangedAt: allAt(at(4, 20, 0)), coldstartDay: {} })
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toEqual([['ioniq/parsed/derived/tire_fr_bar_coldstart', 2.151]])
      })

      it('does not re-publish a day already recorded in the cache', async () => {
        // Restarted after the morning's coldstart had already gone out.
        await restart({
          wheelChangedAt: allAt(at(4, 20, 0)),
          coldstartDay: { fl: '2026-08-05', fr: '2026-08-05', rl: '2026-08-05', rr: '2026-08-05' }
        })
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(coldstarts(mqtt)).toEqual([])
      })

      it('tolerates a cache written before coldstartDay existed', async () => {
        await restart({ wheelChangedAt: { fr: at(4, 20, 0) } })
        await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
        expect(published(mqtt, 'tire_fr_bar_coldstart').value).toBe(2.151)
      })
    })

    // jest.global-setup.js pins the whole suite to TZ=UTC, and jest's node
    // environment hands tests a plain-object copy of process.env, so assigning
    // TZ inside a test never reaches the binding that resets V8's date cache —
    // local-day and UTC-day keying are indistinguishable in-process. The only
    // way to pin the distinction is to replay the frames in a child node with
    // TZ actually set in its environment.
    describe('day boundary is local, not UTC', () => {
      const replayIn = (tz, frames) => {
        const script = `
          const create = require(${JSON.stringify(require.resolve('./ioniq-tpms'))})
          const out = []
          const subs = {}
          const mqtt = {
            subscribe: (t, cb) => { subs[t] = cb; return Promise.resolve() },
            publish: (t, p) => { if (/_bar_coldstart$/.test(t)) out.push(p.value); return Promise.resolve() }
          }
          const bot = create('t', { speedTopics: [] })
          bot.start({ mqtt, persistedCache: { lastRaw: null, wheelChangedAt: {}, coldstartDay: {} } })
            .then(async () => {
              for (const f of ${JSON.stringify(frames)}) await subs['ioniq/parsed/tpms'](f)
              process.stdout.write(JSON.stringify(out))
            })
        `
        return JSON.parse(require('child_process').execFileSync(
          process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }
        ))
      }

      // 00:30 and 10:00 Sofia on 5 August are ONE local day but TWO UTC days
      // (21:30 UTC on the 4th and 07:00 UTC on the 5th). Both starts follow a
      // park of more than six hours, so only the day key separates them.
      const FRAMES = [
        tpms(Date.UTC(2026, 7, 4, 12, 0), {}),
        tpms(Date.UTC(2026, 7, 4, 21, 30), { fr: FRESH_FR }),
        tpms(Date.UTC(2026, 7, 5, 7, 0), { fr: { psi: 34, c: 30 } })
      ]

      it('publishes once for two starts either side of UTC midnight', () => {
        expect(replayIn('Europe/Sofia', FRAMES)).toEqual([2.151])
      })

      it('would publish twice if the day were keyed in UTC', () => {
        // Not a requirement — this pins that the fixture actually discriminates,
        // so the test above cannot pass for the wrong reason.
        expect(replayIn('UTC', FRAMES)).toEqual([2.151, 2.344])
      })
    })

    it('declares a persistedCache migration for the new coldstartDay map', () => {
      const spec = createIoniqTpms('ioniq-tpms', config).persistedCache
      expect(spec.version).toBeGreaterThan(2)
      expect(spec.default).toHaveProperty('coldstartDay')
      const migrated = spec.migrate({
        version: 2, defaultState: spec.default, state: { lastRaw: null, wheelChangedAt: { fr: 1 } }
      })
      expect(migrated.coldstartDay).toEqual({})
      expect(migrated.wheelChangedAt).toEqual({ fr: 1 })
    })

    it('keeps publishing the normalised series alongside the coldstart one', async () => {
      await seed(at(4, 20, 0))
      await mqtt._trigger(TPMS, tpms(at(5, 5, 17), { fr: FRESH_FR }))
      expect(published(mqtt, 'tire_fr_bar_cold')).toBeDefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_bar')).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Issue #1479, defect 2: TEMP_COEFF = 0.18 psi/°C over-compensated by ~15 %, so
  // `psi_cold` drifted *down* as the tyre heated instead of staying flat and the
  // "cold" value depended on how long ago the car had been driven.
  // ---------------------------------------------------------------------------
  describe('gas-law compensation (issue #1479)', () => {
    // Ten points sampled from the verbatim FR trace of the 2026-08-09 run cited
    // in the issue, spanning 33 °C -> 47 °C. Measured rate over the full 45-point
    // run: 0.167 psi/°C, against the 0.18 the linearisation assumed.
    const FR_RUN = [
      [33.2, 33], [33.6, 33], [34, 34], [34.2, 36], [34.4, 37],
      [34.6, 39], [35, 41], [35.2, 43], [35.4, 45], [36, 47]
    ]

    it('does not drift downward as the tyre heats through a run', async () => {
      const vals = []
      for (let i = 0; i < FR_RUN.length; i++) {
        const [psi, c] = FR_RUN[i]
        await mqtt._trigger(TPMS, sample({ ts: 1000 + i, fr: { psi, c } }))
        vals.push(published(mqtt, 'tire_fr_psi_cold').value)
      }
      // The property that matters is that the "cold" value carries no remaining
      // dependence on tyre temperature — otherwise it silently encodes how long
      // ago the car was driven. Least-squares slope of psi_cold against tyre
      // temperature: 0.0076 psi/°C here, against -0.0140 for the 0.18 psi/°C
      // linearisation on the same ten points. Over all 10 548 points published
      // across the 27 days to 2026-08-10 the same comparison is -0.0099 against
      // -0.0291. Not zero: pressure quantises at 0.2 psi and temperature at
      // 1 °C, so ~0.6 psi of scatter is in the inputs and no formula removes it.
      const temps = FR_RUN.map(([, c]) => c)
      const mt = temps.reduce((a, b) => a + b, 0) / temps.length
      const mv = vals.reduce((a, b) => a + b, 0) / vals.length
      const slope = temps.reduce((a, t, i) => a + (t - mt) * (vals[i] - mv), 0) /
        temps.reduce((a, t) => a + (t - mt) ** 2, 0)
      expect(slope).toBeGreaterThan(0)
      expect(slope).toBeLessThan(0.01)
    })

    it('compensates by the gas law rather than a flat 0.18 psi/°C', async () => {
      // 35.4 psi at 45 °C. Linearised: 35.4 - 0.18*30 = 30.0.
      // Gas law: (35.4+14.6959)*288.15/318.15 - 14.6959 = 30.68.
      await mqtt._trigger(TPMS, sample({ fr: { psi: 35.4, c: 45 } }))
      expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(30.68)
    })

    it('leaves a wheel already at the reference temperature untouched', async () => {
      await mqtt._trigger(TPMS, sample({ fr: { psi: 32.5, c: 15 } }))
      expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(32.5)
    })

    it('ignores a temperature at or below absolute zero instead of dividing by zero', async () => {
      await mqtt._trigger(TPMS, sample({ fr: { psi: 32.5, c: -273.15 } }))
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
    })
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
      // remaining cold: fr 31.81, rl 32.03, rr 32.59 → spread 32.59-31.81 = 0.78
      expect(published(mqtt, 'tire_spread_psi').value).toBe(0.78)
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
        expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(34.88)
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
      // gas law to 15 °C: fl 33.33 ; fr 31.7 ; rl 32.07 ; rr 32.44
      expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(33.33)
      expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(31.7)
      expect(published(mqtt, 'tire_rl_psi_cold').value).toBe(32.07)
      expect(published(mqtt, 'tire_rr_psi_cold').value).toBe(32.44)
    })

    it('emits all four cold pressures in bar from a verbatim prod frame', async () => {
      await mqtt._trigger(TPMS, PROD)
      // the psi values above / 14.5038
      expect(published(mqtt, 'tire_fl_bar_cold').value).toBe(2.298)
      expect(published(mqtt, 'tire_fr_bar_cold').value).toBe(2.185)
      expect(published(mqtt, 'tire_rl_bar_cold').value).toBe(2.211)
      expect(published(mqtt, 'tire_rr_bar_cold').value).toBe(2.237)
    })

    it('emits spread and temp_excess from a verbatim prod frame', async () => {
      await mqtt._trigger(TPMS, PROD)
      // max 33.33 (fl) - min 31.7 (fr) = 1.64 (unrounded 1.6295)
      expect(published(mqtt, 'tire_spread_psi').value).toBe(1.64)
      expect(published(mqtt, 'tire_spread_bar').value).toBe(0.113)
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
      // The bar series is what the alerts read, so it must survive the gate too.
      expect(published(mqtt, 'tire_rl_bar_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_bar')).toBeDefined()
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
      expect(published(mqtt, 'tire_rr_bar_cold')).toBeDefined()
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
