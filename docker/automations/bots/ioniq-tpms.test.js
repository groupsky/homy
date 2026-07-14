const { describe, expect, it, jest, beforeEach } = require('@jest/globals')
const createIoniqTpms = require('./ioniq-tpms')

const TPMS = 'ioniq/parsed/tpms'
const AMBIENT = 'ioniq/parsed/ambient'
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
  return { lastRaw: null }
}

const config = { tpmsTopic: TPMS, ambientTopic: AMBIENT }

// Realistic prod-derived sample (2026-07-14 routy). Cold-normalize to 15 °C @ 0.18 psi/°C.
// fl: 36.6 - 0.18*(35-15) = 33.0 ; fr: 35.2 - 0.18*(36-15) = 31.42
// rl: 35.6 - 0.18*(37-15) = 31.64 ; rr: 36.2 - 0.18*(37-15) = 32.24
function sample (overrides = {}) {
  return {
    _type: 'ioniq',
    group: 'tpms',
    state: 'active',
    ts: 1000,
    'fl.psi': 36.6, 'fl.c': 35,
    'fr.psi': 35.2, 'fr.c': 36,
    'rl.psi': 35.6, 'rl.c': 37,
    'rr.psi': 36.2, 'rr.c': 37,
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
    await mqtt._trigger(TPMS, sample({ 'fl.c': undefined }))
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
      await mqtt._trigger(TPMS, sample({ ts: 2, 'fl.psi': 30.0 }))
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
      await mqtt._trigger(TPMS, sample({ 'fl.psi': undefined }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })

    it('excludes a psi-less wheel from spread', async () => {
      await mqtt._trigger(TPMS, sample({ 'fl.psi': undefined }))
      // remaining cold: fr 31.42, rl 31.64, rr 32.24 → spread 32.24-31.42 = 0.82
      expect(published(mqtt, 'tire_spread_psi').value).toBe(0.82)
    })

    it('still counts a psi-less-but-temp-present wheel in others temp_excess', async () => {
      // fl has temp 35 but no psi. fr temp_excess still uses fl's temp in the mean.
      await mqtt._trigger(TPMS, sample({ 'fl.psi': undefined }))
      expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-0.33)
    })

    it('emits no psi_cold for a wheel missing both its temp and any ambient', async () => {
      await mqtt._trigger(TPMS, sample({ 'fl.c': undefined }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
    })

    it('does not emit spread when fewer than two wheels are valid', async () => {
      await mqtt._trigger(TPMS, sample({
        'fr.psi': undefined, 'rl.psi': undefined, 'rr.psi': undefined
      }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_psi')).toBeUndefined()
    })

    it('does not emit temp_excess for a lone-temp wheel', async () => {
      await mqtt._trigger(TPMS, sample({
        'fr.c': undefined, 'rl.c': undefined, 'rr.c': undefined,
        'fr.psi': undefined, 'rl.psi': undefined, 'rr.psi': undefined
      }))
      expect(publishedTopics(mqtt)).not.toContain(P('tire_fl_temp_excess'))
    })

    it('does not emit temp_excess for a wheel using only ambient fallback temp', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ 'fl.c': undefined }))
      // fl still gets a cold pressure (via ambient) but no temp_excess (no own temp)
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_fl_temp_excess')).toBeUndefined()
    })

    it('excludes an ambient-fallback wheel from the others temp_excess mean', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ 'fl.c': undefined }))
      // fr excess uses only fr,rl,rr real temps: 36 - mean(37,37) = 36 - 37 = -1
      expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-1)
    })

    it('ignores a non-finite ambient temp', async () => {
      await mqtt._trigger(AMBIENT, { c: 'n/a' })
      await mqtt._trigger(TPMS, sample({ 'fl.c': undefined }))
      // no valid temp for fl → no psi_cold
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
    })
  })
})
