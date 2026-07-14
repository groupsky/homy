const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const createIoniq12vLdc = require('./ioniq-12v-ldc')

const INPUT = 'ioniq/parsed/bms/2101'
const LDC_OK = 'ioniq/parsed/derived/ldc_ok'
const AUX_DROP = 'ioniq/parsed/derived/aux12v_drop'
const BASE = 1700000000000

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
  return { window: [], auxDropLatchUntil: 0 }
}

// Feed a sample at BASE+offsetMs of receipt (fake) time.
function feed (mqtt, offsetMs, sample) {
  jest.setSystemTime(BASE + offsetMs)
  return mqtt._trigger(INPUT, { ts: BASE + offsetMs, ...sample })
}

// Last published payload on a given topic.
function lastFor (mqtt, topic) {
  const calls = mqtt.publish.mock.calls.filter((c) => c[0] === topic)
  return calls.length ? calls[calls.length - 1][1] : undefined
}

describe('ioniq-12v-ldc bot', () => {
  let mqtt, persistedCache, bot
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(BASE)
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniq12vLdc('ioniq-12v-ldc', {
      inputTopic: INPUT,
      ldcOkTopic: LDC_OK,
      auxDropTopic: AUX_DROP
    })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('subscribes only to the exact input topic (no wildcard)', async () => {
    await bot.start({ mqtt, persistedCache })
    expect(mqtt.subscribe).toHaveBeenCalledTimes(1)
    expect(mqtt.subscribe).toHaveBeenCalledWith(INPUT, expect.any(Function))
  })

  describe('derived/ldc_ok', () => {
    it('stays 1 under heavy traction low voltage (no false fault)', async () => {
      await bot.start({ mqtt, persistedCache })
      // 60 s of low voltage but HV load always high -> load-explained, not a fault.
      for (const t of [0, 20000, 40000, 48000, 54000, 60000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 8, state: 'active' })
      }
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })

    it('emits 0 after low voltage sustained >=60 s at low HV load', async () => {
      await bot.start({ mqtt, persistedCache })
      for (const t of [0, 20000, 40000, 48000, 54000, 60000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      }
      expect(lastFor(mqtt, LDC_OK).value).toBe(0)
    })

    it('stays 1 before 60 s of history is covered even with fault-shaped samples', async () => {
      await bot.start({ mqtt, persistedCache })
      for (const t of [0, 20000, 40000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      }
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })

    it('stays 1 when a recovery sample >= 13.2 V appears within the 60 s', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      await feed(mqtt, 30000, { aux_12v: 13.5, ignition: 1, hv_kw: 0.2, state: 'active' })
      for (const t of [48000, 54000, 60000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      }
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })

    it('stays 1 when ignition drops to 0 within the 60 s', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      await feed(mqtt, 30000, { aux_12v: 12.9, ignition: 0, hv_kw: 0.2, state: 'active' })
      for (const t of [48000, 54000, 60000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      }
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })

    it('does not fault on a single low-load blip inside heavy traction', async () => {
      await bot.start({ mqtt, persistedCache })
      // 60 s low voltage, load heavy everywhere except one brief coast blip mid-window.
      await feed(mqtt, 0, { aux_12v: 12.9, ignition: 1, hv_kw: 8, state: 'active' })
      await feed(mqtt, 20000, { aux_12v: 12.9, ignition: 1, hv_kw: 8, state: 'active' })
      await feed(mqtt, 30000, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' }) // blip
      for (const t of [40000, 48000, 54000, 60000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 8, state: 'active' })
      }
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })

    it('stays 1 when the trailing 15 s contains a high-load sample', async () => {
      await bot.start({ mqtt, persistedCache })
      // 60 s of low voltage, mostly low-load (coverage IS met), but the newest
      // sample (in the last 15 s) is high-load -> load-explained, no fault.
      for (const t of [0, 20000, 40000, 50000]) {
        await feed(mqtt, t, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      }
      await feed(mqtt, 60000, { aux_12v: 12.9, ignition: 1, hv_kw: 8, state: 'active' })
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })

    it('does not false-fault on a lone fresh bad sample after a telemetry gap', async () => {
      await bot.start({ mqtt, persistedCache })
      // A healthy sample, then ~62 s of silence, then one cold-start bad sample.
      // The stale sample survives the 65 s max-age prune, so a naive "oldest is
      // >=60 s old" coverage check would false-fault on this single fresh sample.
      await feed(mqtt, 0, { aux_12v: 13.6, ignition: 1, hv_kw: 5, state: 'active' })
      await feed(mqtt, 62000, { aux_12v: 12.9, ignition: 1, hv_kw: 0.2, state: 'active' })
      expect(lastFor(mqtt, LDC_OK).value).toBe(1)
    })
  })

  describe('derived/aux12v_drop', () => {
    it('flags a fast sag of >= 0.8 V within 5 s', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 13.0, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 3000, { aux_12v: 12.1, ignition: 1, hv_kw: 2, state: 'active' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(1)
    })

    it('does not flag a fast drop below 0.8 V', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 13.0, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 3000, { aux_12v: 12.6, ignition: 1, hv_kw: 2, state: 'active' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(0)
    })

    it('flags a slow parked drift of >= 0.3 V/min', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 12.8, ignition: 0, hv_kw: 0, state: 'parked' })
      await feed(mqtt, 30000, { aux_12v: 12.6, ignition: 0, hv_kw: 0, state: 'parked' })
      await feed(mqtt, 60000, { aux_12v: 12.4, ignition: 0, hv_kw: 0, state: 'parked' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(1)
    })

    it('does not flag the same slow drift while active (parked-only)', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 12.8, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 30000, { aux_12v: 12.6, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 60000, { aux_12v: 12.4, ignition: 1, hv_kw: 2, state: 'active' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(0)
    })

    it('does not corrupt the slow-drift rate with a pre-park active sample', async () => {
      await bot.start({ mqtt, persistedCache })
      // active at higher voltage, then park; a naive oldest-sample ref would falsely fault.
      await feed(mqtt, 0, { aux_12v: 12.9, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 8000, { aux_12v: 12.8, ignition: 0, hv_kw: 0, state: 'parked' })
      await feed(mqtt, 40000, { aux_12v: 12.7, ignition: 0, hv_kw: 0, state: 'parked' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(0)
    })

    it('latches high across subsequent non-sag samples then clears after the hold', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 13.0, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 3000, { aux_12v: 12.1, ignition: 1, hv_kw: 2, state: 'active' }) // fast sag
      expect(lastFor(mqtt, AUX_DROP).value).toBe(1)
      // 30 s later, rail steady low, no new sag -> still latched high.
      await feed(mqtt, 33000, { aux_12v: 12.1, ignition: 1, hv_kw: 2, state: 'active' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(1)
      // beyond the 60 s hold from the sag (sag at 3000, hold until 63000) -> clears.
      await feed(mqtt, 64000, { aux_12v: 12.1, ignition: 1, hv_kw: 2, state: 'active' })
      expect(lastFor(mqtt, AUX_DROP).value).toBe(0)
    })
  })

  describe('payload shape and robustness', () => {
    it('emits the convention payload for both signals', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { ts: 999, aux_12v: 13.5, ignition: 1, hv_kw: 2, state: 'active' })
      const ldc = lastFor(mqtt, LDC_OK)
      expect(ldc).toEqual({ _type: 'ioniq', group: 'derived/ldc_ok', state: 'active', ts: 999, value: 1 })
      const drop = lastFor(mqtt, AUX_DROP)
      expect(drop).toEqual({ _type: 'ioniq', group: 'derived/aux12v_drop', state: 'active', ts: 999, value: 0 })
    })

    it('ignores null / partial payloads without publishing or growing the window', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, null)
      await feed(mqtt, 1000, { ignition: 1, hv_kw: 2, state: 'active' }) // no aux_12v
      await feed(mqtt, 2000, { aux_12v: 13.5, hv_kw: 2, state: 'active' }) // no ignition
      await feed(mqtt, 3000, { aux_12v: 13.5, ignition: 1, state: 'active' }) // no hv_kw
      await feed(mqtt, 4000, { aux_12v: 'x', ignition: 1, hv_kw: 2, state: 'active' }) // non-numeric
      expect(mqtt.publish).not.toHaveBeenCalled()
      expect(persistedCache.window).toHaveLength(0)
    })

    it('bounds the window by sample count', async () => {
      bot = createIoniq12vLdc('ioniq-12v-ldc', {
        inputTopic: INPUT, ldcOkTopic: LDC_OK, auxDropTopic: AUX_DROP, windowMaxSamples: 5
      })
      await bot.start({ mqtt, persistedCache })
      for (let i = 0; i < 20; i++) {
        await feed(mqtt, i * 100, { aux_12v: 13.5, ignition: 1, hv_kw: 2, state: 'active' })
      }
      expect(persistedCache.window.length).toBeLessThanOrEqual(5)
    })

    it('bounds the window by age', async () => {
      await bot.start({ mqtt, persistedCache })
      await feed(mqtt, 0, { aux_12v: 13.5, ignition: 1, hv_kw: 2, state: 'active' })
      await feed(mqtt, 100000, { aux_12v: 13.5, ignition: 1, hv_kw: 2, state: 'active' })
      // first sample is 100 s old, beyond the 65 s max age -> pruned.
      expect(persistedCache.window.every((s) => s.rxTs >= BASE + 100000 - 65000)).toBe(true)
      expect(persistedCache.window).toHaveLength(1)
    })
  })
})
