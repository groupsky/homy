// ioniq-cell-health: reduces raw per-segment cell-voltage and module-temperature
// frames into pack-level derived signals (derived/cell_spread_mv,
// derived/module_temp_spread_c) that Grafana can alert on with a plain
// classic_conditions threshold, instead of expressing 96-cell array math and
// cross-frame merges in InfluxQL.

// The framework JSON-parses the MQTT envelope, but the cells/module_temps
// fields inside carry their own JSON-string-encoded float arrays. Tolerate an
// already-parsed array too (defensive, mirrors ioniq-dtc's parseCodes) so a
// delivery quirk can't silently corrupt a segment.
//
// Also rejects an all-zero array: the OBD logger occasionally decodes a
// "no data" ECU response as literal 0s instead of omitting the frame, and a
// same-length all-zero array otherwise passes every other check here. 32
// cell voltages or 5-7 module temps reading exactly 0.0 in unison is not a
// real sensor state, so treat it the same as a malformed frame and keep the
// prior segment rather than merge garbage into the spread calculation.
function parseFloatArray (raw, expectedLen) {
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
  if (arr.every((n) => n === 0)) {
    return null
  }
  return arr
}

// Round to 0.1 to strip binary floating-point noise (e.g. (3.70-3.64)*1000 =
// 60.00000000000006) from the value written to InfluxDB and rendered in the
// Grafana annotation. 0.1 keeps well below the ~10 mV / ~0.1 °C sensor
// granularity, so no meaningful precision is lost.
function round1 (n) {
  return Math.round(n * 10) / 10
}

module.exports = function createIoniqCellHealth (name, config) {
  const cellTopics = config.cellTopics || [
    'ioniq/parsed/cells/1',
    'ioniq/parsed/cells/33',
    'ioniq/parsed/cells/65'
  ]
  const moduleTemp1Topic = config.moduleTemp1Topic || 'ioniq/parsed/bms/2101'
  const moduleTemp2Topic = config.moduleTemp2Topic || 'ioniq/parsed/bms/2105'
  const cellSpreadOutputTopic = config.cellSpreadOutputTopic || 'ioniq/parsed/derived/cell_spread_mv'
  const moduleTempSpreadOutputTopic = config.moduleTempSpreadOutputTopic || 'ioniq/parsed/derived/module_temp_spread_c'
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  // The three cells/* topics map 1:1 to persistedCache.seg0/seg1/seg2 in
  // array order (topic index 0 -> cells 1-32, 1 -> 33-64, 2 -> 65-96).
  const segKeys = ['seg0', 'seg1', 'seg2']

  return {
    persistedCache: {
      version: 1,
      // Holds the last-known-good parsed array per segment. null means "not
      // yet received" (or "never a good value") — a bad frame never
      // overwrites a good one.
      default: { seg0: null, seg1: null, seg2: null, moduleTemps: null, moduleTemps6_12: null }
    },

    start: async ({ mqtt, persistedCache }) => {
      const handleCells = (segKey) => (payload) => {
        const parsed = parseFloatArray(payload && payload.cells, 32)
        if (parsed === null) {
          log(`rejected malformed cells frame for ${segKey}, keeping prior segment`)
          return
        }
        persistedCache[segKey] = parsed

        // Rest-spread only: a moving pack under load skews cell voltages, so
        // only parked/charging samples are meaningful here.
        if (payload.state === 'active') return

        const { seg0, seg1, seg2 } = persistedCache
        if (seg0 === null || seg1 === null || seg2 === null) return

        const cells = seg0.concat(seg1, seg2)
        const max = Math.max(...cells)
        const min = Math.min(...cells)
        const mean = cells.reduce((sum, cell) => sum + cell, 0) / cells.length

        // 1-based index of the cell furthest from the pack mean; ties resolve
        // to the lowest index. outlierIndex defaults to 1 — arbitrary but
        // harmless — when the pack is perfectly balanced (value 0, every
        // cell tied at zero deviation).
        let outlierIndex = 1
        let maxDeviation = -Infinity
        cells.forEach((cell, i) => {
          const deviation = Math.abs(cell - mean)
          if (deviation > maxDeviation) {
            maxDeviation = deviation
            outlierIndex = i + 1
          }
        })

        mqtt.publish(cellSpreadOutputTopic, {
          _type: 'ioniq',
          group: 'derived/cell_spread_mv',
          state: payload.state,
          ts: payload.ts,
          value: round1((max - min) * 1000),
          outlierIndex
        })
      }

      const handleModuleTemps = (segKey, expectedLen, field) => (payload) => {
        const parsed = parseFloatArray(payload && payload[field], expectedLen)
        if (parsed === null) {
          log(`rejected malformed ${field} frame, keeping prior segment`)
          return
        }
        persistedCache[segKey] = parsed

        const { moduleTemps, moduleTemps6_12 } = persistedCache
        if (moduleTemps === null || moduleTemps6_12 === null) return

        const temps = moduleTemps.concat(moduleTemps6_12)
        mqtt.publish(moduleTempSpreadOutputTopic, {
          _type: 'ioniq',
          group: 'derived/module_temp_spread_c',
          state: payload.state,
          ts: payload.ts,
          value: round1(Math.max(...temps) - Math.min(...temps))
        })
      }

      await Promise.all([
        ...cellTopics.map((topic, index) => mqtt.subscribe(topic, handleCells(segKeys[index]))),
        mqtt.subscribe(moduleTemp1Topic, handleModuleTemps('moduleTemps', 5, 'module_temps')),
        mqtt.subscribe(moduleTemp2Topic, handleModuleTemps('moduleTemps6_12', 7, 'module_temps_6_12'))
      ])
    }
  }
}
