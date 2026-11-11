const {beforeEach, describe, expect, it, jest} = require('@jest/globals')
const {createUniverse} = require('./universe')

// Stands in for the native DMX universe: records what was written to it.
function fakeDevice() {
  return {
    frames: [],
    hz: null,
    stepSize: null,
    setHz(hz) { this.hz = hz },
    step(s) { this.stepSize = s },
    set(values) { this.frames.push(values) },
  }
}

// A manual timer queue, so backoff delays are asserted without waiting.
function fakeTimers() {
  const pending = []
  return {
    pending,
    setTimer(fn, ms) { const t = {fn, ms}; pending.push(t); return t },
    clearTimer(t) { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1) },
    runNext() { const t = pending.shift(); t.fn(); return t.ms },
  }
}

const quietLog = {log() {}, error() {}}
const delays = {initialMs: 1000, maxMs: 8000}

describe('createUniverse', () => {
  let timers
  let states

  beforeEach(() => {
    timers = fakeTimers()
    states = []
  })

  function make(open) {
    return createUniverse({
      open,
      onState: (s) => states.push(s),
      log: quietLog,
      delays,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
  }

  it('opens the adapter, sets it up and blanks the channels', () => {
    const device = fakeDevice()
    const universe = make(() => device)

    universe.start()

    expect(universe.isOpen()).toBe(true)
    expect(device.hz).toBe(20)
    expect(device.stepSize).toBe(5)
    expect(device.frames).toEqual([0])
    expect(states.map(s => s.state)).toEqual(['opening', 'online'])
  })

  it('does not throw when the adapter cannot be opened, and reports it offline', () => {
    const universe = make(() => { throw new TypeError('ftdi_usb_open_dev failed: -4 (libusb_open() failed)') })

    expect(() => universe.start()).not.toThrow()

    expect(universe.isOpen()).toBe(false)
    expect(states[1]).toEqual({state: 'offline', error: 'ftdi_usb_open_dev failed: -4 (libusb_open() failed)', attempt: 1})
    expect(timers.pending).toHaveLength(1)
  })

  it('retries with a doubling delay capped at the maximum', () => {
    const universe = make(() => { throw new Error('gone') })
    universe.start()

    const waits = []
    for (let i = 0; i < 5; i++) waits.push(timers.runNext())

    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000])
    expect(states.filter(s => s.state === 'offline')).toHaveLength(6)
  })

  it('recovers once the adapter returns and writes the frame received while it was away', () => {
    const device = fakeDevice()
    let present = false
    const universe = make(() => { if (!present) throw new Error('gone'); return device })
    universe.start()

    // A reading arrives while the adapter is still away: kept, not lost.
    universe.set([128, 0, 128])
    timers.runNext()
    expect(universe.isOpen()).toBe(false)

    present = true
    timers.runNext()

    expect(universe.isOpen()).toBe(true)
    expect(device.frames).toEqual([[128, 0, 128]])
    expect(states.at(-1)).toEqual({state: 'online', attempt: 3})
    expect(timers.pending).toHaveLength(0)

    universe.set([0, 0, 0])
    expect(device.frames.at(-1)).toEqual([0, 0, 0])
  })

  it('treats a failure while setting the adapter up as an open failure', () => {
    const device = fakeDevice()
    device.setHz = () => { throw new Error('setup failed') }
    const universe = make(() => device)

    universe.start()

    expect(universe.isOpen()).toBe(false)
    expect(states.at(-1).state).toBe('offline')
  })

  it('stops retrying after stop()', () => {
    const open = jest.fn(() => { throw new Error('gone') })
    const universe = make(open)
    universe.start()

    universe.stop()

    expect(timers.pending).toHaveLength(0)
    expect(open).toHaveBeenCalledTimes(1)
  })
})
