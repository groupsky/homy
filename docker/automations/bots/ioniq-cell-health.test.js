const { beforeEach, describe, expect, it, jest } = require('@jest/globals')
const createIoniqCellHealth = require('./ioniq-cell-health')

const CELLS1 = 'ioniq/parsed/cells/1'
const CELLS33 = 'ioniq/parsed/cells/33'
const CELLS65 = 'ioniq/parsed/cells/65'
const BMS2101 = 'ioniq/parsed/bms/2101'
const BMS2105 = 'ioniq/parsed/bms/2105'
const CELL_SPREAD_OUT = 'ioniq/parsed/derived/cell_spread_mv'
const MODULE_TEMP_SPREAD_OUT = 'ioniq/parsed/derived/module_temp_spread_c'

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
  return { seg0: null, seg1: null, seg2: null, moduleTemps: null, moduleTemps6_12: null }
}

const config = {
  cellTopics: [CELLS1, CELLS33, CELLS65],
  moduleTemp1Topic: BMS2101,
  moduleTemp2Topic: BMS2105,
  cellSpreadOutputTopic: CELL_SPREAD_OUT,
  moduleTempSpreadOutputTopic: MODULE_TEMP_SPREAD_OUT
}

// 32 identical cell voltages, used as the "balanced segment" baseline in
// most tests so spread math is easy to reason about.
function flatSegment (value = 3.64) {
  return new Array(32).fill(value)
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
})

describe('ioniq-cell-health bot — cell_spread_mv', () => {
  let mqtt, persistedCache, bot
  beforeEach(async () => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    bot = createIoniqCellHealth('ioniq-cell-health', config)
    await bot.start({ mqtt, persistedCache })
  })

  it('reassembles the full 96-cell pack and computes spread/outlier across a segment boundary', async () => {
    const seg0 = flatSegment()
    const seg1 = flatSegment()
    const seg2 = flatSegment()
    // Cell 70 = seg2[5] (65 + 5 = 70), the outlier.
    seg2[5] = 3.70

    await mqtt._trigger(CELLS1, { cells: JSON.stringify(seg0), state: 'parked', ts: 1000 })
    await mqtt._trigger(CELLS33, { cells: JSON.stringify(seg1), state: 'parked', ts: 1000 })
    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg2), state: 'parked', ts: 1000 })

    // (3.70 - 3.64) * 1000 = 60.00000000000006 raw; the bot rounds to 0.1 mV.
    expect(mqtt.publish).toHaveBeenLastCalledWith(CELL_SPREAD_OUT, {
      _type: 'ioniq',
      group: 'derived/cell_spread_mv',
      state: 'parked',
      ts: 1000,
      value: 60,
      outlierIndex: 70
    })
  })

  it('skips emission while active, then emits on a subsequent parked sample', async () => {
    const seg = flatSegment()
    await mqtt._trigger(CELLS1, { cells: JSON.stringify(seg), state: 'active', ts: 1 })
    await mqtt._trigger(CELLS33, { cells: JSON.stringify(seg), state: 'active', ts: 1 })
    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg), state: 'active', ts: 1 })
    expect(mqtt.publish).not.toHaveBeenCalledWith(CELL_SPREAD_OUT, expect.anything())

    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg), state: 'parked', ts: 2 })
    expect(mqtt.publish).toHaveBeenCalledWith(CELL_SPREAD_OUT, expect.objectContaining({ state: 'parked', ts: 2 }))
  })

  it('emits for charging state too (only active is skipped)', async () => {
    const seg = flatSegment()
    await mqtt._trigger(CELLS1, { cells: JSON.stringify(seg), state: 'charging', ts: 1 })
    await mqtt._trigger(CELLS33, { cells: JSON.stringify(seg), state: 'charging', ts: 1 })
    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg), state: 'charging', ts: 1 })
    expect(mqtt.publish).toHaveBeenCalledWith(CELL_SPREAD_OUT, expect.objectContaining({ state: 'charging', value: 0 }))
  })

  it('does not emit until all three segments have arrived', async () => {
    const seg = flatSegment()
    await mqtt._trigger(CELLS1, { cells: JSON.stringify(seg), state: 'parked', ts: 1 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    await mqtt._trigger(CELLS33, { cells: JSON.stringify(seg), state: 'parked', ts: 2 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg), state: 'parked', ts: 3 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['non-JSON string', 'not-json{{{'],
    ['wrong length (31)', JSON.stringify(flatSegment().slice(0, 31))],
    ['non-array', JSON.stringify({ not: 'an array' })],
    ['NaN element', JSON.stringify([...flatSegment().slice(0, 31), null])],
    ['all-zero array (garbage no-data frame)', JSON.stringify(new Array(32).fill(0))]
  ])('rejects a malformed cells frame (%s) and keeps the prior good segment, with no emission from the bad frame', async (_label, badCells) => {
    const seg = flatSegment()
    await mqtt._trigger(CELLS1, { cells: JSON.stringify(seg), state: 'parked', ts: 1 })
    await mqtt._trigger(CELLS33, { cells: JSON.stringify(seg), state: 'parked', ts: 1 })
    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg), state: 'parked', ts: 1 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    mqtt.publish.mockClear()

    // Corrupt segment 1 (CELLS33) — must not emit at all for this bad frame.
    await mqtt._trigger(CELLS33, { cells: badCells, state: 'parked', ts: 2 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    // A subsequent good frame on any topic re-triggers emission using the
    // retained (prior good) segment 1 — never NaN.
    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg), state: 'parked', ts: 3 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    const published = mqtt.publish.mock.calls[0][1]
    expect(Number.isNaN(published.value)).toBe(false)
    expect(published.value).toBe(0)
  })

  it('breaks an outlier tie by choosing the lowest index', async () => {
    const seg0 = flatSegment()
    seg0[4] = 3.70 // cell 5 (1-based)
    seg0[9] = 3.70 // cell 10 (1-based), tied deviation from mean
    const seg1 = flatSegment()
    const seg2 = flatSegment()

    await mqtt._trigger(CELLS1, { cells: JSON.stringify(seg0), state: 'parked', ts: 1 })
    await mqtt._trigger(CELLS33, { cells: JSON.stringify(seg1), state: 'parked', ts: 1 })
    await mqtt._trigger(CELLS65, { cells: JSON.stringify(seg2), state: 'parked', ts: 1 })

    expect(mqtt.publish).toHaveBeenCalledWith(CELL_SPREAD_OUT, expect.objectContaining({ outlierIndex: 5 }))
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

  it('rejects an all-zero module_temps frame (garbage no-data OBD frame) instead of merging it into the spread', async () => {
    const moduleTemps = [30, 31, 29, 30, 30]
    const moduleTemps6_12 = [30, 30, 33, 30, 30, 30, 28]
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify(moduleTemps), state: 'parked', ts: 1 })
    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 1 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    mqtt.publish.mockClear()

    // A garbage all-zero frame must not overwrite the retained good segment
    // or emit a bogus spread from it.
    await mqtt._trigger(BMS2101, { module_temps: JSON.stringify([0, 0, 0, 0, 0]), state: 'parked', ts: 2 })
    expect(mqtt.publish).not.toHaveBeenCalled()

    await mqtt._trigger(BMS2105, { module_temps_6_12: JSON.stringify(moduleTemps6_12), state: 'parked', ts: 3 })
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    expect(mqtt.publish).toHaveBeenCalledWith(MODULE_TEMP_SPREAD_OUT, expect.objectContaining({ value: 33 - 28 }))
  })
})
