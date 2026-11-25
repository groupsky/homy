/**
 * Power dip guard for digital input modules (#2007).
 *
 * The 12 V supply of the `dry-switches` input modules is not on the UPS. At a
 * mains dip the modules restart: first one reading where many inputs drop at
 * once (a "partial reading"), then `inputs: 0` for a few seconds, then the
 * value from before the dip. A partial reading looks like switch presses to
 * every consumer, so the reader holds it back here.
 *
 * - Dip start, on any guarded module: a reading of 0, or `minChangedBits` or
 *   more bits changed against the last published value of that module.
 * - Hold: any other change is published only after a good read of every
 *   guarded module (not in a dip) came after it with no dip start. A failed
 *   read does not count, so the hold goes on, but never longer than
 *   `stableMs`: a module that stopped answering must not stop the others.
 *   The change keeps its own `_tz`.
 * - During a dip nothing is published for any guarded module.
 * - Dip end, per module: the reading equals the value from before the dip
 *   (after the module showed a change), or a non-zero reading has not
 *   changed for `stableMs`. A reading of 0 never ends a dip, and a failed
 *   read never ends it either. At the end the reading is published.
 * - A dip event `{state: 'start' | 'end', _tz, durationMs, readings}` is
 *   published at the start and when the last module ended. `readings` holds
 *   the raw readings that were held (at most `maxReadings`).
 *
 * The guard only sees reads; it does not touch the bus. It is a plain object
 * with no timers, so the time is the `_tz` of each read.
 */

const DEFAULTS = {
  minChangedBits: 3,
  stableMs: 1000,
  maxReadings: 20,
  msLogInterval: 5 * 60 * 1000,
}

const countBits = (value) => {
  let rest = value >>> 0
  let count = 0
  while (rest) {
    count += rest & 1
    rest >>>= 1
  }
  return count
}

const hex = (value) => value === undefined ? 'unknown' : (value >>> 0).toString(16).padStart(8, '0')

/**
 * @param {object} config the `powerDipGuard` object of the bus config
 * @param {string[]} config.devices names of the guarded input modules
 * @param {object} hooks
 * @param {(entry: object, device: object) => void} hooks.publishReading
 * @param {(event: object) => void} hooks.publishEvent
 * @param {(line: string) => void} [hooks.log]
 */
function createPowerDipGuard (config, { publishReading, publishEvent, log = console.log }) {
  const { devices, minChangedBits, stableMs, maxReadings, msLogInterval } = { ...DEFAULTS, ...config }
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new Error('powerDipGuard.devices must list the guarded input modules')
  }

  // Per module: `published` is the last value consumers got, `raw` the last
  // value read. In a dip `before` is the value from before it and
  // `candidate` the non-zero value that may end it once stable.
  const modules = new Map(devices.map((name) => [name, {
    name,
    published: undefined,
    raw: undefined,
    inDip: false,
    before: undefined,
    seenChange: false,
    candidate: null,
  }]))

  // Held changes in read order: {entry, device, heldAt, waitFor: Set of names}
  let queue = []
  // The running dip: {startTz, readings, lastLog}, or null
  let dip = null

  const publish = (module, entry, device) => {
    module.published = entry.inputs
    publishReading(entry, device)
  }

  const describe = () => [...modules.values()]
    .map((m) => `${m.name} ${hex(m.inDip ? m.before : m.published)} -> ${hex(m.raw)}`)
    .join(', ')

  const addReading = (entry) => {
    if (dip.readings.length < maxReadings) {
      dip.readings.push({ device: entry.device, inputs: entry.inputs >>> 0, _tz: entry._tz })
    }
  }

  const event = (state, tz) => ({
    state,
    _tz: tz,
    durationMs: tz - dip.startTz,
    readings: dip.readings.slice(),
    _type: 'power-dip',
    device: 'power-dip',
  })

  const isDipStart = (module, value) =>
    value === 0 || (module.published !== undefined && countBits(value ^ module.published) >= minChangedBits)

  const startDip = (module, entry, now) => {
    const first = !dip
    if (first) dip = { startTz: now, readings: [], lastLog: now }
    // Changes still held are part of the dip: they are never published as such.
    for (const held of queue) addReading(held.entry)
    queue = []
    addReading(entry)
    for (const m of modules.values()) {
      if (m.inDip) continue
      m.inDip = true
      m.before = m.published
      m.seenChange = false
      m.candidate = m.raw ? { value: m.raw, since: now } : null
    }
    // The module that started the dip shows a change: its value is not the one before.
    module.seenChange = module.raw !== module.before
    if (first) {
      log(`power dip start on ${module.name}: ${describe()}`)
      publishEvent(event('start', now))
    } else {
      log(`power dip: ${module.name} is in the dip again: ${describe()}`)
    }
  }

  const endModule = (module, entry, device, now) => {
    module.inDip = false
    publish(module, entry, device)
    if ([...modules.values()].some((m) => m.inDip)) return
    log(`power dip end after ${now - dip.startTz} ms: ${[...modules.values()]
      .map((m) => `${m.name} ${hex(m.published)} (before ${hex(m.before)})`).join(', ')}, ${dip.readings.length} readings held`)
    publishEvent(event('end', now))
    dip = null
  }

  const readInDip = (module, value, previous, entry, device, now) => {
    // Only a new value is kept for the dip event, not the driver's periodic report.
    if (value !== previous) addReading(entry)
    if (value !== module.before) module.seenChange = true
    if (!module.candidate || module.candidate.value !== value) {
      module.candidate = value !== 0 ? { value, since: now } : null
    }
    const back = module.seenChange && module.before !== undefined && value === module.before
    const stable = module.candidate && now - module.candidate.since >= stableMs
    if (back || stable) endModule(module, entry, device, now)
  }

  const readNormal = (module, value, entry, device, now) => {
    if (entry && isDipStart(module, value)) {
      startDip(module, entry, now)
      return
    }
    // A good read with no dip start confirms the changes held before it.
    for (const held of queue) held.waitFor.delete(module.name)
    if (!entry) return
    const holding = queue.some((held) => held.device.name === module.name)
    if (!holding && value === module.published) {
      // The driver's periodic report of an unchanged value: nothing to hold.
      publish(module, entry, device)
      return
    }
    const waitFor = new Set([...modules.values()].filter((m) => !m.inDip).map((m) => m.name))
    queue.push({ entry, device, heldAt: now, waitFor })
  }

  const release = (now) => {
    while (queue.length && (queue[0].waitFor.size === 0 || now - queue[0].heldAt >= stableMs)) {
      const { entry, device } = queue.shift()
      publish(modules.get(device.name), entry, device)
    }
  }

  const logIfLong = (now) => {
    if (!dip || now - dip.lastLog < msLogInterval) return
    dip.lastLog = now
    const waiting = [...modules.values()].filter((m) => m.inDip).map((m) => m.name).join(', ')
    log(`power dip still on after ${now - dip.startTz} ms, waiting for ${waiting}: ${describe()}`)
  }

  return {
    has: (name) => modules.has(name),

    /**
     * A good read. `val` is what the driver returned: a reading with
     * `inputs`, or undefined when the value did not change. `meta` holds the
     * fields the reader adds to every reading (`_tz`, `_ms`, ...).
     */
    onRead (device, val, meta) {
      const module = modules.get(device.name)
      const now = meta._tz
      const previous = module.raw
      const value = val != null ? val.inputs : module.raw
      if (value === undefined) return
      module.raw = value
      // Every published reading is a full one, also when the driver had
      // nothing new: the end of a dip publishes the current value.
      const entry = val != null ? Object.assign(val, meta) : null
      if (module.inDip) {
        readInDip(module, value, previous, entry || { inputs: value, ...meta }, device, now)
      } else {
        readNormal(module, value, entry, device, now)
      }
      release(now)
      logIfLong(now)
    },

    /** A failed read: it neither confirms a held change nor ends a dip. */
    onReadError (device, now) {
      release(now)
      logIfLong(now)
    },
  }
}

module.exports = { createPowerDipGuard, countBits }
