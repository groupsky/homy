const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const createIoniqDtc = require('./ioniq-dtc')

const STORED = 'ioniq/parsed/dtc/stored'
const PENDING = 'ioniq/parsed/dtc/pending'
const OUTPUT = 'ioniq/parsed/derived/dtc_count'

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
  return { stored: [], pending: [], flaggedKey: '' }
}

const config = {
  storedTopic: STORED,
  pendingTopic: PENDING,
  outputTopic: OUTPUT,
  httpPost: jest.fn().mockResolvedValue({ ok: true })
}

describe('ioniq-dtc bot — derived signal', () => {
  let mqtt, persistedCache, bot
  beforeEach(() => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    config.httpPost = jest.fn().mockResolvedValue({ ok: true })
    bot = createIoniqDtc('ioniq-dtc', config)
  })

  it('subscribes to both dtc topics', async () => {
    await bot.start({ mqtt, persistedCache })
    expect(mqtt.subscribe).toHaveBeenCalledWith(STORED, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(PENDING, expect.any(Function))
  })

  it('publishes value 0 with empty codes and no flag', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'parked', ts: 100, codes: [] })
    expect(mqtt.publish).toHaveBeenCalledWith(OUTPUT, {
      _type: 'ioniq', group: 'derived/dtc_count', state: 'parked', ts: 100, value: 0, codes: []
    })
    expect(config.httpPost).not.toHaveBeenCalled()
  })

  it('publishes the count and union of codes when a DTC appears', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 200, codes: ['P0AA6'] })
    expect(mqtt.publish).toHaveBeenLastCalledWith(OUTPUT, {
      _type: 'ioniq', group: 'derived/dtc_count', state: 'active', ts: 200, value: 1, codes: ['P0AA6']
    })
  })

  it('unions stored and pending, de-duplicating shared codes', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 300, codes: ['P0AA6', 'P1B76'] })
    await mqtt._trigger(PENDING, { group: 'dtc/pending', state: 'active', ts: 301, codes: ['P1B76', 'C1611'] })
    expect(mqtt.publish).toHaveBeenLastCalledWith(OUTPUT, {
      _type: 'ioniq', group: 'derived/dtc_count', state: 'active', ts: 301, value: 3,
      codes: ['P0AA6', 'P1B76', 'C1611']
    })
  })

  it('treats a missing codes field as empty', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'parked', ts: 400 })
    expect(mqtt.publish).toHaveBeenLastCalledWith(OUTPUT, expect.objectContaining({ value: 0, codes: [] }))
  })
})

describe('ioniq-dtc bot — direct flag', () => {
  let mqtt, persistedCache, bot
  beforeEach(() => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    config.httpPost = jest.fn().mockResolvedValue({ ok: true })
    config.telegramWebhookUrl = 'http://telegram-bridge:3000/webhook'
    bot = createIoniqDtc('ioniq-dtc', config)
  })

  it('flags once when a DTC appears, naming the code and source', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    expect(config.httpPost).toHaveBeenCalledTimes(1)
    expect(config.httpPost).toHaveBeenCalledWith(
      'http://telegram-bridge:3000/webhook',
      { message: '🚗 <b>DTC present</b>: P0AA6 (stored)' }
    )
  })

  it('does not re-flag the same code set on repeated samples', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 2, codes: ['P0AA6'] })
    expect(config.httpPost).toHaveBeenCalledTimes(1)
  })

  it('flags again after the codes clear and a new DTC appears', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 2, codes: [] })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 3, codes: ['P0AA6'] })
    expect(config.httpPost).toHaveBeenCalledTimes(2)
  })

  it('does not re-flag a code set already flagged before restart', async () => {
    persistedCache.stored = ['P0AA6']
    persistedCache.flaggedKey = 'P0AA6'
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 5, codes: ['P0AA6'] })
    expect(config.httpPost).not.toHaveBeenCalled()
  })

  it('still publishes the derived signal when the HTTP flag fails', async () => {
    config.httpPost = jest.fn().mockRejectedValue(new Error('bridge down'))
    bot = createIoniqDtc('ioniq-dtc', config)
    await bot.start({ mqtt, persistedCache })
    await expect(
      mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    ).resolves.not.toThrow()
    expect(mqtt.publish).toHaveBeenCalledWith(OUTPUT, expect.objectContaining({ value: 1 }))
  })

  it('never flags when flagOnEdge is false', async () => {
    config.flagOnEdge = false
    bot = createIoniqDtc('ioniq-dtc', config)
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    expect(config.httpPost).not.toHaveBeenCalled()
    delete config.flagOnEdge
  })
})
