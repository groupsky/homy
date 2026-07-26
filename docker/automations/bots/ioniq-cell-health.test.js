const { beforeEach, describe, expect, it, jest } = require('@jest/globals')
const createIoniqCellHealth = require('./ioniq-cell-health')

const CELLS1 = 'ioniq/parsed/cells/1'
const CELLS33 = 'ioniq/parsed/cells/33'
const CELLS65 = 'ioniq/parsed/cells/65'
const BMS2101 = 'ioniq/parsed/bms/2101'
const BMS2105 = 'ioniq/parsed/bms/2105'
const CELL_SPREAD_OUT = 'ioniq/parsed/derived/cell_spread_mv'
const MODULE_TEMP_SPREAD_OUT = 'ioniq/parsed/derived/module_temp_spread_c'

const MINUTE = 60 * 1000

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
  return {
    seg0: null,
    seg1: null,
    seg2: null,
    moduleTemps: null,
    moduleTemps6_12: null,
    stamps: {}
  }
}

const config = {
  cellTopics: [CELLS1, CELLS33, CELLS65],
  bmsTopic: BMS2101,
  moduleTemp2Topic: BMS2105,
  cellSpreadOutputTopic: CELL_SPREAD_OUT,
  moduleTempSpreadOutputTopic: MODULE_TEMP_SPREAD_OUT
}

// 32 identical cell voltages, used as the "balanced segment" baseline in
// most tests so spread math is easy to reason about.
function flatSegment (value = 3.64) {
  return new Array(32).fill(value)
}

// A minimal bms/2101 frame carrying only the fields the cell-spread path reads.
function bmsFrame ({ max, min, state = 'parked', ts = 1000 }) {
  return { cell_max_v: max, cell_min_v: min, state, ts }
}

// Drives one full cells poll cycle (the three segments arrive ~150 ms apart in
// production) followed by the bms/2101 frame that triggers the publish.
async function pollCycle (mqtt, { seg0, seg1, seg2, ts, state = 'parked' }) {
  await mqtt._trigger(CELLS1, { cells: seg0, state, ts })
  await mqtt._trigger(CELLS33, { cells: seg1, state, ts: ts + 150 })
  await mqtt._trigger(CELLS65, { cells: seg2, state, ts: ts + 300 })
}

describe('ioniq-cell-health bot — subscriptions', () => {
  it('subscribes to all five exact topics', async () => {
    const mqtt = makeMqtt()
    const bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache: makeCache() })
    expect(mqtt.subscribe).toHaveBeenCalledWith(CELLS1, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(CELLS33, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(CELLS65, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(BMS2101, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(BMS2105, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledTimes(5)
  })

  it('accepts the pre-#1418 moduleTemp1Topic name for the bms/2101 topic', async () => {
    const mqtt = makeMqtt()
    const legacy = { ...config, moduleTemp1Topic: BMS2101 }
    delete legacy.bmsTopic
    const bot = createIoniqCellHealth('ioniq-cell-health', legacy)
    await bot.start({ mqtt, persistedCache: makeCache() })
    expect(mqtt.subscribe).toHaveBeenCalledWith(BMS2101, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledTimes(5)
  })
})

describe('ioniq-cell-health bot — persistedCache', () => {
  it('is at version 2 and defaults to an empty stamp map', () => {
    const bot = createIoniqCellHealth('ioniq-cell-health', config)
    expect(bot.persistedCache.version).toBe(2)
    expect(bot.persistedCache.default.stamps).toEqual({})
  })

  it('migrates a v1 cache without stamps, leaving the carried-over segments unstamped', () => {
    const bot = createIoniqCellHealth('ioniq-cell-health', config)
    const state = { seg0: flatSegment(), seg1: flatSegment(), seg2: flatSegment(), moduleTemps: null, moduleTemps6_12: null }
    const migrated = bot.persistedCache.migrate({
      version: 1,
      defaultState: bot.persistedCache.default,
      state
    })
    expect(migrated.stamps).toEqual({})
    expect(migrated.seg0).toHaveLength(32)
  })

  it('does not discard stamps that are already present', () => {
    const bot = createIoniqCellHealth('ioniq-cell-health', config)
    const migrated = bot.persistedCache.migrate({
      version: 2,
      defaultState: bot.persistedCache.default,
      state: { ...makeCache(), stamps: { seg0: 1234 } }
    })
    expect(migrated.stamps).toEqual({ seg0: 1234 })
  })
})

describe('ioniq-cell-health bot — cell_spread_mv source', () => {
  let mqtt, persistedCache, bot
  beforeEach(async () => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })
  })

  it('derives the spread from the contemporaneous cell_max_v/cell_min_v pair on bms/2101', async () => {
    await mqtt._trigger(BMS2101, bmsFrame({ max: 4.08, min: 4.06, state: 'charging', ts: 1000 }))

    // (4.08 - 4.06) * 1000 = 20.000000000000018 raw; the bot rounds to 0.1 mV.
    expect(mqtt.publish).toHaveBeenCalledWith(CELL_SPREAD_OUT, {
      _type: 'ioniq',
      group: 'derived/cell_spread_mv',
      state: 'charging',
      ts: 1000,
      value: 20
    })
  })

  it('never publishes cell_spread_mv from a cells/* segment frame', async () => {
    await pollCycle(mqtt, {
      seg0: flatSegment(), seg1: flatSegment(), seg2: flatSegment(), ts: 1000
    })
    expect(mqtt.publish).not.toHaveBeenCalled()
  })

  it('skips emission while active, then emits on a subsequent parked frame', async () => {
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.7, min: 3.64, state: 'active', ts: 1 }))
    expect(mqtt.publish).not.toHaveBeenCalledWith(CELL_SPREAD_OUT, expect.anything())

    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.7, min: 3.64, state: 'parked', ts: 2 }))
    expect(mqtt.publish).toHaveBeenCalledWith(CELL_SPREAD_OUT,
      expect.objectContaining({ state: 'parked', ts: 2, value: 60 }))
  })

  it('publishes a genuine imbalance so the Grafana critical rule still fires', async () => {
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.9, min: 3.64, state: 'parked', ts: 5 }))
    const published = mqtt.publish.mock.calls.find((c) => c[0] === CELL_SPREAD_OUT)[1]
    expect(published.value).toBe(260)
    expect(published.value).toBeGreaterThan(100)
  })

  it.each([
    ['missing both fields', {}],
    ['missing cell_min_v', { cell_max_v: 3.7 }],
    ['non-numeric cell_max_v', { cell_max_v: '3.7', cell_min_v: 3.64 }],
    ['NaN cell_min_v', { cell_max_v: 3.7, cell_min_v: NaN }],
    ['garbage all-zero no-data frame', { cell_max_v: 0, cell_min_v: 0 }],
    ['partially zero frame', { cell_max_v: 3.8, cell_min_v: 0 }],
    ['implausibly high cell voltage', { cell_max_v: 12.4, cell_min_v: 3.8 }],
    ['inverted max/min', { cell_max_v: 3.6, cell_min_v: 3.8 }]
  ])('does not publish cell_spread_mv for an unusable bms frame (%s)', async (_label, fields) => {
    await mqtt._trigger(BMS2101, { state: 'parked', ts: 1, ...fields })
    expect(mqtt.publish).not.toHaveBeenCalledWith(CELL_SPREAD_OUT, expect.anything())
  })
})

describe('ioniq-cell-health bot — outlierIndex freshness gate', () => {
  let mqtt, persistedCache, bot
  beforeEach(async () => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })
  })

  const lastSpread = () => {
    const calls = mqtt.publish.mock.calls.filter((c) => c[0] === CELL_SPREAD_OUT)
    return calls.length ? calls[calls.length - 1][1] : null
  }

  it('attaches the outlier cell index when all three segments and the bms frame are mutually fresh', async () => {
    const seg2 = flatSegment()
    seg2[5] = 3.70 // cell 70 = 65 + 5
    await pollCycle(mqtt, { seg0: flatSegment(), seg1: flatSegment(), seg2, ts: 1000 })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1400 }))

    expect(lastSpread()).toEqual(expect.objectContaining({ value: 60, outlierIndex: 70 }))
  })

  it('breaks an outlier tie by choosing the lowest index', async () => {
    const seg0 = flatSegment()
    seg0[4] = 3.70 // cell 5 (1-based)
    seg0[9] = 3.70 // cell 10 (1-based), tied deviation from mean
    await pollCycle(mqtt, { seg0, seg1: flatSegment(), seg2: flatSegment(), ts: 1000 })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1400 }))

    expect(lastSpread()).toEqual(expect.objectContaining({ outlierIndex: 5 }))
  })

  it('omits outlierIndex when one segment is older than the freshness window', async () => {
    await mqtt._trigger(CELLS1, { cells: flatSegment(), state: 'parked', ts: 1000 })
    await mqtt._trigger(CELLS33, { cells: flatSegment(), state: 'parked', ts: 1150 })
    await mqtt._trigger(CELLS65, { cells: flatSegment(), state: 'parked', ts: 1000 + 11 * MINUTE })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1000 + 11 * MINUTE }))

    const published = lastSpread()
    expect(published.value).toBe(60)
    expect(published).not.toHaveProperty('outlierIndex')
  })

  it('omits outlierIndex when the segments are fresh with each other but stale against the bms frame', async () => {
    await pollCycle(mqtt, { seg0: flatSegment(), seg1: flatSegment(), seg2: flatSegment(), ts: 1000 })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1000 + 30 * MINUTE }))

    expect(lastSpread()).not.toHaveProperty('outlierIndex')
  })

  it('omits outlierIndex when a segment has never been received', async () => {
    await mqtt._trigger(CELLS1, { cells: flatSegment(), state: 'parked', ts: 1000 })
    await mqtt._trigger(CELLS33, { cells: flatSegment(), state: 'parked', ts: 1150 })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1300 }))

    expect(lastSpread()).not.toHaveProperty('outlierIndex')
  })

  it('omits outlierIndex on a migrated cache that carries segments but no stamps', async () => {
    const warmMqtt = makeMqtt()
    const warmCache = {
      seg0: flatSegment(),
      seg1: flatSegment(),
      seg2: flatSegment(),
      moduleTemps: null,
      moduleTemps6_12: null,
      stamps: {}
    }
    const warmBot = createIoniqCellHealth('ioniq-cell-health', config)
    await warmBot.start({ mqtt: warmMqtt, persistedCache: warmCache })

    await warmMqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1000 }))
    const published = warmMqtt.publish.mock.calls.find((c) => c[0] === CELL_SPREAD_OUT)[1]
    expect(published.value).toBe(60)
    expect(published).not.toHaveProperty('outlierIndex')
  })

  it('tolerates a cache written before the stamp map existed', async () => {
    const legacyMqtt = makeMqtt()
    const legacyCache = { seg0: null, seg1: null, seg2: null, moduleTemps: null, moduleTemps6_12: null }
    const legacyBot = createIoniqCellHealth('ioniq-cell-health', config)
    await legacyBot.start({ mqtt: legacyMqtt, persistedCache: legacyCache })

    await legacyMqtt._trigger(CELLS1, { cells: flatSegment(), state: 'parked', ts: 1000 })
    expect(legacyCache.stamps).toEqual({ seg0: 1000 })
  })

  it('omits outlierIndex when the bms frame carries no usable timestamp', async () => {
    await pollCycle(mqtt, { seg0: flatSegment(), seg1: flatSegment(), seg2: flatSegment(), ts: 1000 })
    await mqtt._trigger(BMS2101, { cell_max_v: 3.70, cell_min_v: 3.64, state: 'parked' })

    expect(lastSpread()).not.toHaveProperty('outlierIndex')
  })

  it('honours a segmentFreshnessWindowMs of 0 (exact simultaneity required)', async () => {
    const strictMqtt = makeMqtt()
    const strictBot = createIoniqCellHealth('ioniq-cell-health', { ...config, segmentFreshnessWindowMs: 0 })
    await strictBot.start({ mqtt: strictMqtt, persistedCache: makeCache() })

    await pollCycle(strictMqtt, { seg0: flatSegment(), seg1: flatSegment(), seg2: flatSegment(), ts: 1000 })
    await strictMqtt._trigger(BMS2101, bmsFrame({ max: 3.70, min: 3.64, ts: 1000 }))

    const published = strictMqtt.publish.mock.calls.find((c) => c[0] === CELL_SPREAD_OUT)[1]
    expect(published).not.toHaveProperty('outlierIndex')
  })
})

describe('ioniq-cell-health bot — production wake-up replay (issue #1418)', () => {
  // Real frames from the two observed artefacts. In both cases the raw segments
  // were clean (all cells within one 20 mV BMS quantisation step) but the cache
  // still held segments from the previous session's pack voltage, so the join
  // produced 440 mV / 260 mV against a real spread of 20 mV / 0 mV.
  const mixedSegment = (a, b) => {
    const seg = new Array(32).fill(b)
    seg[0] = a
    seg[11] = a
    return seg
  }

  it('2026-07-24 05:10 — publishes 20 mV, not 440 mV, with the previous session at 3.64 V still cached', async () => {
    const mqtt = makeMqtt()
    // Previous evening's session, cached across the sleep.
    const persistedCache = {
      seg0: flatSegment(3.64),
      seg1: flatSegment(3.64),
      seg2: flatSegment(3.64),
      moduleTemps: null,
      moduleTemps6_12: null,
      stamps: { seg0: 1000, seg1: 1150, seg2: 1300 }
    }
    const bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })

    // Wake-up poll cycle, ~10 h later. bms/2101 lands first (05:10:56.023),
    // then the three segments 0.7-1.0 s behind it.
    const wake = 1000 + 10 * 60 * MINUTE
    await mqtt._trigger(BMS2101, bmsFrame({ max: 4.08, min: 4.06, state: 'charging', ts: wake }))
    await mqtt._trigger(CELLS1, { cells: mixedSegment(4.06, 4.08), state: 'charging', ts: wake + 687 })
    await mqtt._trigger(CELLS33, { cells: mixedSegment(4.06, 4.08), state: 'charging', ts: wake + 845 })
    await mqtt._trigger(CELLS65, { cells: mixedSegment(4.06, 4.08), state: 'charging', ts: wake + 1008 })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 4.08, min: 4.06, state: 'charging', ts: wake + 4012 }))

    const spreads = mqtt.publish.mock.calls
      .filter((c) => c[0] === CELL_SPREAD_OUT)
      .map((c) => c[1].value)
    expect(spreads.length).toBeGreaterThan(0)
    expect(Math.max(...spreads)).toBeLessThanOrEqual(50)
    expect(spreads.every((v) => v === 20)).toBe(true)
  })

  it('2026-07-22 05:07 — publishes 0 mV, not 260 mV, with the previous session at 3.78 V still cached', async () => {
    const mqtt = makeMqtt()
    const persistedCache = {
      seg0: flatSegment(3.78),
      seg1: flatSegment(3.78),
      seg2: flatSegment(3.78),
      moduleTemps: null,
      moduleTemps6_12: null,
      stamps: { seg0: 1000, seg1: 1150, seg2: 1300 }
    }
    const bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })

    const wake = 1000 + 10 * 60 * MINUTE
    await mqtt._trigger(CELLS1, { cells: flatSegment(4.04), state: 'charging', ts: wake })
    await mqtt._trigger(CELLS33, { cells: flatSegment(4.04), state: 'charging', ts: wake + 127 })
    await mqtt._trigger(BMS2101, bmsFrame({ max: 4.04, min: 4.04, state: 'charging', ts: wake + 400 }))

    const spreads = mqtt.publish.mock.calls
      .filter((c) => c[0] === CELL_SPREAD_OUT)
      .map((c) => c[1].value)
    expect(spreads).toEqual([0])
  })
})

describe('ioniq-cell-health bot — cells segment parsing', () => {
  let mqtt, persistedCache, bot
  beforeEach(async () => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })
  })

  it('accepts both a JSON-encoded string and an already-parsed array', async () => {
    await mqtt._trigger(CELLS1, { cells: JSON.stringify(flatSegment()), state: 'parked', ts: 1000 })
    expect(persistedCache.seg0).toHaveLength(32)

    await mqtt._trigger(CELLS33, { cells: flatSegment(), state: 'parked', ts: 1150 })
    expect(persistedCache.seg1).toHaveLength(32)
  })

  it.each([
    ['non-JSON string', 'not-json{{{'],
    ['wrong length (31)', JSON.stringify(flatSegment().slice(0, 31))],
    ['non-array', JSON.stringify({ not: 'an array' })],
    ['NaN element', JSON.stringify([...flatSegment().slice(0, 31), null])],
    ['all-zero array (garbage no-data frame)', JSON.stringify(new Array(32).fill(0))],
    ['partially zero array', JSON.stringify([...flatSegment().slice(0, 31), 0])],
    ['implausibly high cell voltage', JSON.stringify([...flatSegment().slice(0, 31), 12.4])],
    ['negative cell voltage', JSON.stringify([...flatSegment().slice(0, 31), -3.64])]
  ])('rejects a malformed cells frame (%s), keeps the prior good segment and its stamp', async (_label, badCells) => {
    await pollCycle(mqtt, { seg0: flatSegment(), seg1: flatSegment(), seg2: flatSegment(), ts: 1000 })
    expect(persistedCache.stamps.seg1).toBe(1150)

    await mqtt._trigger(CELLS33, { cells: badCells, state: 'parked', ts: 5000 })
    expect(persistedCache.seg1).toEqual(flatSegment())
    expect(persistedCache.stamps.seg1).toBe(1150)

    // The retained segment still contributes a finite outlier index.
    await mqtt._trigger(BMS2101, bmsFrame({ max: 3.64, min: 3.64, ts: 5100 }))
    const published = mqtt.publish.mock.calls.find((c) => c[0] === CELL_SPREAD_OUT)[1]
    expect(Number.isNaN(published.value)).toBe(false)
    expect(published.value).toBe(0)
    expect(published.outlierIndex).toBe(1)
  })
})

describe('ioniq-cell-health bot — module_temp_spread_c', () => {
  let mqtt, persistedCache, bot
  beforeEach(async () => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })
  })

  it('merges the 5+7 module temps and computes max-min, passing through state/ts and _type/group', async () => {
    const moduleTemps = [30, 31, 29, 30, 30]
    const moduleTemps6_12 = [30, 30, 33, 30, 30, 30, 28]

    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(moduleTemps), state: 'parked', ts: 500 })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 501 })

    expect(mqtt.publish).toHaveBeenLastCalledWith(MODULE_TEMP_SPREAD_OUT, {
      _type: 'ioniq',
      group: 'derived/module_temp_spread_c',
      state: 'parked',
      ts: 501,
      value: 33 - 28
    })
  })

  it('emits even when state is active (no active-skip for module temps)', async () => {
    const moduleTemps = [30, 30, 30, 30, 30]
    const moduleTemps6_12 = [30, 30, 30, 30, 30, 30, 30]
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(moduleTemps), state: 'active', ts: 1 })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'active', ts: 1 })

    expect(mqtt.publish).toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT,
      expect.objectContaining({ state: 'active', value: 0 }))
  })

  it('does not emit until both module-temp frames have arrived', async () => {
    const moduleTemps = [30, 30, 30, 30, 30]
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(moduleTemps), state: 'parked', ts: 1 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    const moduleTemps6_12 = [30, 30, 30, 30, 30, 30, 30]
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 2 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
  })

  it('suppresses the spread when the two frames are further apart than the freshness window', async () => {
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([30, 31, 29, 30, 30]), state: 'parked', ts: 1000 })
    await mqtt._trigger(BMS2105, {
      module_temps_6_12: JSON.stringify([30, 30, 33, 30, 30, 30, 28]),
      state: 'parked',
      ts: 1000 + 11 * MINUTE
    })

    expect(mqtt.publish).not.toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.anything())
  })

  it('suppresses the spread on a migrated cache whose carried-over module temps have no stamp', async () => {
    const warmMqtt = makeMqtt()
    const warmCache = {
      seg0: null,
      seg1: null,
      seg2: null,
      moduleTemps: [30, 31, 29, 30, 30],
      moduleTemps6_12: null,
      stamps: {}
    }
    const warmBot = createIoniqCellHealth('ioniq-cell-health', config)
    await warmBot.start({ mqtt: warmMqtt, persistedCache: warmCache })

    await warmMqtt._trigger(BMS2105, {
      module_temps_6_12: JSON.stringify([30, 30, 33, 30, 30, 30, 28]),
      state: 'parked',
      ts: 1000
    })
    expect(warmMqtt.publish).not.toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.anything())
  })

  it('suppresses the spread when a module-temp frame carries no usable timestamp', async () => {
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([30, 31, 29, 30, 30]), state: 'parked' })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify([30, 30, 33, 30, 30, 30, 28]), state: 'parked', ts: 1000 })

    expect(mqtt.publish).not.toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.anything())
  })

  it('rejects a malformed module_temps frame, keeps the prior good segment, and does not emit for the bad frame', async () => {
    const moduleTemps = [30, 31, 29, 30, 30]
    const moduleTemps6_12 = [30, 30, 33, 30, 30, 30, 28]
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(moduleTemps), state: 'parked', ts: 1 })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 1 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    mqtt.publish.mockClear()

    // wrong length (4 instead of 5) — rejected, no emission from this frame
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([30, 31, 29, 30]), state: 'parked', ts: 2 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    // retrigger with the other good topic — should use retained good moduleTemps
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 3 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    expect(mqtt.publish).toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.objectContaining({ value: 33 - 28 }))
  })

  it.each([
    ['all-zero array (garbage no-data frame)', [0, 0, 0, 0, 0]],
    ['implausibly high module temperature', [30, 31, 29, 30, 500]],
    ['implausibly low module temperature', [30, 31, 29, 30, -273]],
    // Real partial "no data" decodes from production. The last two published
    // module_temp_spread_c of 31 °C and 32 °C, twice the critical threshold.
    ['partial no-data zeros, 2026-07-14', [27, 27, 26, 0, 0]],
    ['partial no-data zeros, 2026-07-17 16:23', [31, 31, 0, 0, 0]],
    ['partial no-data zeros, 2026-07-17 17:52', [32, 31, 32, 31, 0]]
  ])('rejects a physically impossible module_temps frame (%s) instead of merging it into the spread', async (_label, badTemps) => {
    const moduleTemps = [30, 31, 29, 30, 30]
    const moduleTemps6_12 = [30, 30, 33, 30, 30, 30, 28]
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(moduleTemps), state: 'parked', ts: 1 })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 1 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    mqtt.publish.mockClear()

    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(badTemps), state: 'parked', ts: 2 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 3 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    expect(mqtt.publish).toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.objectContaining({ value: 33 - 28 }))
  })

  it('keeps a legitimate 0 °C module temperature (the zero guards must not reject a near-freezing pack)', async () => {
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([0, 1, 0, -1, 0]), state: 'parked', ts: 1 })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify([0, 0, 2, 0, 0, 0, -2]), state: 'parked', ts: 2 })

    expect(mqtt.publish).toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.objectContaining({ value: 4 }))
  })

  // 2026-07-25T07:00:42Z: a wake-up bms/2101 frame reporting 14-16 °C merged with
  // module_temps_6_12 still cached from the previous evening's 07-24T18:14 session
  // at 22-26 °C, publishing an 11 °C spread that cleared the 8 °C warning
  // threshold. bms/2105 refreshed 12 s later and the spread fell back to 2 °C.
  it('2026-07-25 wake-up replay — suppresses the 11 °C spread built from a 12 h stale bms/2105 frame', async () => {
    const eveningTs = 1000
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([24, 24, 23, 23, 25]), state: 'parked', ts: eveningTs })
    await mqtt._trigger(BMS2105, {
      module_temps_6_12: JSON.stringify([24, 23, 24, 22, 23, 25, 24]),
      state: 'parked',
      ts: eveningTs + 500
    })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    mqtt.publish.mockClear()

    const wake = eveningTs + 12.8 * 60 * MINUTE
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([15, 15, 14, 14, 16]), state: 'parked', ts: wake })
    expect(mqtt.publish).not.toHaveBeenCalled()

    // The corrective bms/2105 frame 12 s later re-opens the gate with the real spread.
    await mqtt._trigger(BMS2105, {
      module_temps_6_12: JSON.stringify([16, 15, 16, 14, 14, 15, 14]),
      state: 'parked',
      ts: wake + 12482
    })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    expect(mqtt.publish).toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.objectContaining({ value: 2 }))
  })
})
